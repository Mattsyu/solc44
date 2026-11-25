// API de la popotte café pour Cloudflare Pages (Pages Functions).
// Données stockées dans une base Cloudflare D1, reliée au projet sous le nom « DB ».
// Toutes les routes sont sous /api/*.

/* ===== Valeurs de départ (utilisées seulement au tout premier lancement) ===== */
const DEPART = {
  membres: [
    "Nicolas", "Jean-Philippe", "David", "Fabrice", "Christophe", "Laurent", "Anthony",
    "Richard", "François-Xavier", "Matthieu", "Florent", "Damien", "Patrice",
  ],
  gestionnaire: "Benjamin",
  prix: { cafe: 0.2, eau: 0.5, soft: 0.6 },
};
const PRODUITS = ["cafe", "eau", "soft"];
// Ancien site, pour récupérer les données une fois (Gestionnaire > Réglages).
const ANCIEN_SITE = "https://solc44.netlify.app";
// Mot de passe gestionnaire initial : variable ADMIN_PASSWORD sur Cloudflare, sinon "popotte".
// Mot de passe d'accès au site : variable SITE_PASSWORD sur Cloudflare (obligatoire).
// Ni l'un ni l'autre n'est écrit dans le code, car le dépôt GitHub est public.
const DUREE_ACCES_MS = 90 * 24 * 60 * 60 * 1000; // une tablette déverrouillée le reste 90 jours
const DUREE_SESSION_MS = 30 * 60 * 1000; // une connexion gestionnaire dure 30 min
const DELAI_ANNULATION_MS = 10 * 60 * 1000; // un membre peut annuler son dernier ajout pendant 10 min
/* ============================================================================ */

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const aleatoire = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const uid = () => Date.now().toString(36) + aleatoire(4);
const r2 = (n) => Math.round(n * 100) / 100;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

/* ---------- Petite couche de stockage clé/valeur au-dessus de D1 ---------- */
let schemaPret = false;
async function preparer(db) {
  if (schemaPret) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)").run();
  schemaPret = true;
}
async function lire(db, k) {
  const r = await db.prepare("SELECT v FROM kv WHERE k = ?").bind(k).first();
  return r ? r.v : null;
}
const lireJSON = async (db, k) => { const v = await lire(db, k); return v == null ? null : JSON.parse(v); };
const ecrire = (db, k, v) => db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)").bind(k, v).run();
const effacer = (db, k) => db.prepare("DELETE FROM kv WHERE k = ?").bind(k).run();
// Écrit seulement si la clé n'existe pas encore, puis renvoie la valeur en place.
async function creerSiAbsent(db, k, valeur) {
  await db.prepare("INSERT OR IGNORE INTO kv (k, v) VALUES (?, ?)").bind(k, JSON.stringify(valeur)).run();
  return lireJSON(db, k);
}

/* ---------- Données de la caisse ----------
   Le tout est un seul document JSON, découpé en morceaux (une ligne D1 est limitée à 2 Mo).
   « data:tok » est un numéro de version : une écriture ne passe que si personne n'a écrit entre-temps. */
const TAILLE_MORCEAU = 300000;
const morceauxDe = (texte) => {
  const l = [];
  for (let i = 0; i < texte.length; i += TAILLE_MORCEAU) l.push(texte.slice(i, i + TAILLE_MORCEAU));
  return l.length ? l : [""];
};
function instructionsMorceaux(db, texte, nouveauTok) {
  const garde = "(SELECT v FROM kv WHERE k = 'data:tok') = ?";
  const m = morceauxDe(texte);
  return [
    ...m.map((v, i) =>
      db.prepare(`INSERT OR REPLACE INTO kv (k, v) SELECT ?, ? WHERE ${garde}`).bind("data:c" + i, v, nouveauTok)),
    db.prepare(`INSERT OR REPLACE INTO kv (k, v) SELECT 'data:n', ? WHERE ${garde}`).bind(String(m.length), nouveauTok),
    db.prepare(`DELETE FROM kv WHERE k LIKE 'data:c%' AND CAST(substr(k, 7) AS INTEGER) >= ? AND ${garde}`)
      .bind(m.length, nouveauTok),
  ];
}
async function lireDonnees(db) {
  const { results } = await db.prepare("SELECT k, v FROM kv WHERE k >= 'data:' AND k < 'data;'").all();
  const map = Object.fromEntries(results.map((r) => [r.k, r.v]));
  if (map["data:tok"] && map["data:n"]) {
    let texte = "";
    for (let i = 0; i < Number(map["data:n"]); i++) texte += map["data:c" + i] || "";
    const data = JSON.parse(texte);
    data.signalements ||= [];
    return { data, tok: map["data:tok"] };
  }
  // Tout premier lancement : on crée les données de départ (une seule fois, même si deux appareils arrivent ensemble).
  const data = donneesInitiales();
  const tok = uid();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO kv (k, v) VALUES ('data:tok', ?)").bind(tok),
    ...instructionsMorceaux(db, JSON.stringify(data), tok),
  ]);
  return lireDonnees(db);
}
// Écrit le document seulement si la version n'a pas changé. Renvoie true si c'est passé.
async function ecrireDonnees(db, data, ancienTok) {
  const tok = uid();
  const res = await db.batch([
    db.prepare("UPDATE kv SET v = ? WHERE k = 'data:tok' AND v = ?").bind(tok, ancienTok),
    ...instructionsMorceaux(db, JSON.stringify(data), tok),
  ]);
  return res[0].meta.changes === 1;
}
// Modification sûre même si deux appareils écrivent en même temps.
async function modifier(db, fn) {
  for (let i = 0; i < 6; i++) {
    const { data, tok } = await lireDonnees(db);
    const resultat = await fn(data);
    if (await ecrireDonnees(db, data, tok)) return { data, resultat };
    await pause(50 + Math.random() * 150);
  }
  throw new HttpError(409, "Trop de modifications simultanées, réessayez.");
}

function donneesInitiales() {
  return {
    membres: [
      ...DEPART.membres.map((nom) => ({ id: uid(), nom, gestionnaire: false, actif: true })),
      { id: uid(), nom: DEPART.gestionnaire, gestionnaire: true, actif: true },
    ],
    prix: { ...DEPART.prix },
    consos: [],
    paiements: [],
    signalements: [], // paiements déclarés par les membres, en attente de confirmation
  };
}

/* ---------- Cryptographie (Web Crypto) ---------- */
async function sha256(texte) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(texte)));
}
async function hashMdp(mdp, sel) {
  const cle = await crypto.subtle.importKey("raw", enc.encode(mdp), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(sel), iterations: 100000 }, cle, 256);
  return hex(bits);
}
async function signer(message, secret) {
  const cle = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", cle, enc.encode(String(message))));
}
function egal(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  if (x.length !== y.length) return false;
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(x, y);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function lireAuth(db, env) {
  let auth = await lireJSON(db, "auth");
  if (!auth) {
    const sel = aleatoire(16);
    auth = await creerSiAbsent(db, "auth", {
      sel,
      hash: await hashMdp(env.ADMIN_PASSWORD || "popotte", sel),
      secret: aleatoire(32),
      parDefaut: !env.ADMIN_PASSWORD,
    });
  }
  return auth;
}
// Clé des jetons d'accès : dépend du mot de passe du site, donc le changer déconnecte tous les appareils.
async function cleAcces(db, env) {
  let site = await lireJSON(db, "site");
  if (!site) site = await creerSiAbsent(db, "site", { sel: aleatoire(32) });
  return sha256(site.sel + "\0" + env.SITE_PASSWORD);
}
async function jetonAccesValide(jeton, cle) {
  const [exp, sig] = String(jeton || "").split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return egal(sig, await signer("acces." + exp, cle));
}
async function creerJeton(auth) {
  const exp = Date.now() + DUREE_SESSION_MS;
  return `${exp}.${await signer(exp, auth.secret)}`;
}
async function jetonValide(jeton, auth) {
  const [exp, sig] = String(jeton || "").split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return egal(sig, await signer(exp, auth.secret));
}

/* ---------- Règles ---------- */
function trouverMembre(data, id) {
  const m = data.membres.find((x) => x.id === id);
  if (!m) throw new HttpError(404, "Membre introuvable.");
  return m;
}
function nomValide(v) {
  const nom = String(v || "").trim().slice(0, 60);
  if (!nom) throw new HttpError(400, "Nom vide.");
  return nom;
}
function prixValide(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new HttpError(400, "Prix invalide.");
  return r2(n);
}
const idPropre = (v) => String(v || "").replace(/[^a-z0-9]/gi, "");
const imageValide = (img) =>
  /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img) && img.length <= 600000;
function remplacer(d, x) {
  if (!x || !Array.isArray(x.membres) || !Array.isArray(x.consos) || !Array.isArray(x.paiements) || !x.prix)
    throw new HttpError(400, "Sauvegarde invalide.");
  d.membres = x.membres;
  d.consos = x.consos;
  d.paiements = x.paiements;
  d.prix = x.prix;
  d.signalements = Array.isArray(x.signalements) ? x.signalements : [];
}

// Opérations réservées au gestionnaire.
const OPS_ADMIN = {
  paiement(d, b) {
    trouverMembre(d, b.membreId);
    const montant = r2(Number(b.montant));
    if (!(montant > 0) || montant > 10000) throw new HttpError(400, "Montant invalide.");
    d.paiements.push({ id: uid(), membreId: b.membreId, montant, ts: Date.now() });
  },
  confirmerSignalement(d, b) {
    const sg = d.signalements.find((x) => x.id === b.signalementId);
    if (!sg) throw new HttpError(404, "Signalement introuvable (déjà traité ?).");
    const montant = b.montant != null ? r2(Number(b.montant)) : sg.montant;
    if (!(montant > 0) || montant > 10000) throw new HttpError(400, "Montant invalide.");
    d.paiements.push({ id: uid(), membreId: sg.membreId, montant, ts: Date.now(), signale: true });
    d.signalements = d.signalements.filter((x) => x.id !== sg.id);
  },
  refuserSignalement(d, b) {
    d.signalements = d.signalements.filter((x) => x.id !== b.signalementId);
  },
  avatar(d, b) {
    trouverMembre(d, b.membreId).avatar = Date.now();
  },
  retirerAvatar(d, b) {
    delete trouverMembre(d, b.membreId).avatar;
  },
  annulerPaiement(d, b) {
    d.paiements = d.paiements.filter((p) => p.id !== b.paiementId);
  },
  ajouterMembre(d, b) {
    d.membres.push({ id: uid(), nom: nomValide(b.nom), gestionnaire: false, actif: true });
  },
  renommer(d, b) {
    trouverMembre(d, b.membreId).nom = nomValide(b.nom);
  },
  basculerGestionnaire(d, b) {
    const m = trouverMembre(d, b.membreId);
    m.gestionnaire = !m.gestionnaire;
  },
  basculerActif(d, b) {
    const m = trouverMembre(d, b.membreId);
    m.actif = !m.actif;
  },
  prix(d, b) {
    d.prix = Object.fromEntries(PRODUITS.map((k) => [k, prixValide(b[k])]));
  },
  restaurer(d, b) {
    remplacer(d, b.donnees);
  },
};

// Récupère membres, soldes, historique et images depuis l'ancien site Netlify.
async function importerAncienSite(db, motDePasse) {
  const appel = async (chemin, init) => {
    let r;
    try { r = await fetch(ANCIEN_SITE + "/api/" + chemin, init); }
    catch (_) { throw new HttpError(502, "L'ancien site ne répond pas."); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new HttpError(502, "Ancien site : " + (d.erreur || "erreur " + r.status));
    return d;
  };
  const { acces } = await appel("acces", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ motDePasse: String(motDePasse || "") }),
  });
  const ancien = await appel("etat", { headers: { "x-acces": acces } });
  const images = {};
  for (const m of ancien.membres || []) {
    if (!m.avatar) continue;
    try {
      const { image } = await appel("avatar?id=" + encodeURIComponent(m.id), { headers: { "x-acces": acces } });
      if (imageValide(image)) images[m.id] = image;
      else delete m.avatar;
    } catch (_) {
      delete m.avatar; // image illisible : la tuile affichera les initiales
    }
  }
  for (const [id, image] of Object.entries(images)) await ecrire(db, "avatar/" + idPropre(id), image);
  return modifier(db, (d) => remplacer(d, ancien));
}

export async function onRequest({ request: req, env }) {
  try {
    const db = env.DB;
    if (!db) throw new HttpError(503, "Base de données non reliée (liaison D1 « DB » sur Cloudflare).");
    if (!env.SITE_PASSWORD) {
      throw new HttpError(503, "Mot de passe du site non configuré (variable SITE_PASSWORD sur Cloudflare).");
    }
    await preparer(db);
    const url = new URL(req.url);
    const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // ----- Verrou d'accès au site : rien n'est accessible sans le mot de passe du site. -----
    const cle = await cleAcces(db, env);
    if (route === "acces" && req.method === "POST") {
      if (!egal(await sha256(env.SITE_PASSWORD), await sha256(String(body.motDePasse || "")))) {
        await pause(1000); // ralentit les essais au hasard
        throw new HttpError(401, "Mot de passe incorrect.");
      }
      const exp = Date.now() + DUREE_ACCES_MS;
      return json({ acces: `${exp}.${await signer("acces." + exp, cle)}` });
    }
    if (!(await jetonAccesValide(req.headers.get("x-acces"), cle))) {
      return json({ erreur: "Accès verrouillé.", verrou: true }, 401);
    }

    // État complet (lecture libre sur la tablette).
    if (route === "etat" && req.method === "GET") {
      const { data } = await lireDonnees(db);
      return json(data);
    }

    // Un membre ajoute un café, une eau ou un soft. Prix et heure fixés par le serveur.
    if (route === "conso" && req.method === "POST") {
      if (!PRODUITS.includes(body.type)) throw new HttpError(400, "Type invalide.");
      const { data, resultat } = await modifier(db, (d) => {
        const m = trouverMembre(d, body.membreId);
        if (!m.actif) throw new HttpError(400, "Membre désactivé.");
        const prix = d.prix[body.type];
        if (typeof prix !== "number") throw new HttpError(400, "Prix non défini pour ce produit.");
        const c = { id: uid(), membreId: m.id, type: body.type, prix, ts: Date.now() };
        d.consos.push(c);
        return c;
      });
      return json({ etat: data, conso: resultat });
    }

    // Un membre annule son dernier ajout (10 minutes max).
    if (route === "annuler" && req.method === "POST") {
      const { data } = await modifier(db, (d) => {
        const c = d.consos.find((x) => x.id === body.consoId && x.membreId === body.membreId);
        if (!c) throw new HttpError(404, "Consommation introuvable.");
        if (Date.now() - c.ts > DELAI_ANNULATION_MS) throw new HttpError(400, "Trop tard pour annuler.");
        d.consos = d.consos.filter((x) => x.id !== c.id);
      });
      return json({ etat: data });
    }

    // Un membre signale qu'il a payé : le gestionnaire devra confirmer.
    if (route === "signaler" && req.method === "POST") {
      const montant = r2(Number(body.montant));
      if (!(montant > 0) || montant > 10000) throw new HttpError(400, "Montant invalide.");
      const { data } = await modifier(db, (d) => {
        const m = trouverMembre(d, body.membreId);
        d.signalements = d.signalements.filter((x) => x.membreId !== m.id); // un seul signalement en attente par membre
        d.signalements.push({ id: uid(), membreId: m.id, montant, ts: Date.now() });
      });
      return json({ etat: data });
    }

    // Un membre annule son propre signalement tant qu'il n'est pas confirmé.
    if (route === "annulerSignalement" && req.method === "POST") {
      const { data } = await modifier(db, (d) => {
        d.signalements = d.signalements.filter((x) => !(x.membreId === body.membreId && x.id === body.signalementId));
      });
      return json({ etat: data });
    }

    // Image d'un membre (lecture réservée aux appareils déverrouillés).
    if (route === "avatar" && req.method === "GET") {
      const image = await lire(db, "avatar/" + idPropre(url.searchParams.get("id")));
      if (!image) throw new HttpError(404, "Pas d'image.");
      return new Response(JSON.stringify({ image }), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, max-age=31536000, immutable" },
      });
    }

    const auth = await lireAuth(db, env);

    if (route === "info" && req.method === "GET") {
      return json({ mdpParDefaut: !!auth.parDefaut });
    }

    if (route === "login" && req.method === "POST") {
      if (!egal(await hashMdp(String(body.motDePasse || ""), auth.sel), auth.hash)) {
        await pause(800); // ralentit les essais au hasard
        throw new HttpError(401, "Mot de passe incorrect.");
      }
      return json({ jeton: await creerJeton(auth), mdpParDefaut: !!auth.parDefaut });
    }

    // Tout ce qui suit demande une connexion gestionnaire.
    const jeton = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!(await jetonValide(jeton, auth))) throw new HttpError(401, "Session expirée, reconnectez-vous.");

    if (route === "mdp" && req.method === "POST") {
      const nouveau = String(body.nouveau || "");
      if (nouveau.length < 4) throw new HttpError(400, "4 caractères minimum.");
      const sel = aleatoire(16);
      // Nouveau secret : toutes les autres sessions ouvertes sont déconnectées.
      const nouvelAuth = { sel, hash: await hashMdp(nouveau, sel), secret: aleatoire(32), parDefaut: false };
      await ecrire(db, "auth", JSON.stringify(nouvelAuth));
      return json({ jeton: await creerJeton(nouvelAuth) });
    }

    if (route === "admin" && req.method === "POST") {
      if (body.op === "importerAncienSite") {
        const { data } = await importerAncienSite(db, body.motDePasse);
        return json({ etat: data });
      }
      const op = OPS_ADMIN[body.op];
      if (!op) throw new HttpError(400, "Opération inconnue.");
      // Images : le fichier est rangé à part, la fiche du membre garde juste un numéro de version.
      if (body.op === "avatar") {
        const { data: d0 } = await lireDonnees(db);
        trouverMembre(d0, body.membreId);
        const img = String(body.image || "");
        if (!imageValide(img)) throw new HttpError(400, "Image invalide ou trop lourde.");
        await ecrire(db, "avatar/" + idPropre(body.membreId), img);
      }
      if (body.op === "retirerAvatar") await effacer(db, "avatar/" + idPropre(body.membreId));
      const { data } = await modifier(db, (d) => op(d, body));
      return json({ etat: data });
    }

    throw new HttpError(404, "Route inconnue.");
  } catch (e) {
    if (e instanceof HttpError) return json({ erreur: e.message }, e.status);
    console.error(e);
    return json({ erreur: "Erreur serveur." }, 500);
  }
}
