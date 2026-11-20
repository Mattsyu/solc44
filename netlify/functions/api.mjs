// Fonction Netlify de la popotte café.
// Données stockées dans Netlify Blobs (magasin "popotte").
// Toutes les routes sont sous /api/*.
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

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
// Mot de passe initial : variable d'environnement ADMIN_PASSWORD sur Netlify, sinon "popotte".
const MDP_INITIAL = () => process.env.ADMIN_PASSWORD || "popotte";
const DUREE_SESSION_MS = 30 * 60 * 1000; // une connexion gestionnaire dure 30 min
const DELAI_ANNULATION_MS = 10 * 60 * 1000; // un membre peut annuler son dernier ajout pendant 10 min
/* ============================================================================ */

const uid = () => Date.now().toString(36) + crypto.randomBytes(4).toString("hex");
const r2 = (n) => Math.round(n * 100) / 100;
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

const store = () => getStore({ name: "popotte", consistency: "strong" });

function donneesInitiales() {
  return {
    membres: [
      ...DEPART.membres.map((nom) => ({ id: uid(), nom, gestionnaire: false, actif: true })),
      { id: uid(), nom: DEPART.gestionnaire, gestionnaire: true, actif: true },
    ],
    prix: { ...DEPART.prix },
    consos: [],
    paiements: [],
  };
}

function hashMdp(mdp, sel) {
  return crypto.scryptSync(mdp, sel, 32).toString("hex");
}

async function lireAuth(s) {
  let auth = await s.get("auth", { type: "json" });
  if (!auth) {
    const sel = crypto.randomBytes(16).toString("hex");
    auth = {
      sel,
      hash: hashMdp(MDP_INITIAL(), sel),
      secret: crypto.randomBytes(32).toString("hex"),
      parDefaut: !process.env.ADMIN_PASSWORD,
    };
    const res = await s.setJSON("auth", auth, { onlyIfNew: true });
    if (!res.modified) auth = await s.get("auth", { type: "json" });
  }
  return auth;
}

function signer(exp, secret) {
  return crypto.createHmac("sha256", secret).update(String(exp)).digest("hex");
}
function creerJeton(auth) {
  const exp = Date.now() + DUREE_SESSION_MS;
  return `${exp}.${signer(exp, auth.secret)}`;
}
function jetonValide(jeton, auth) {
  if (!jeton) return false;
  const [exp, sig] = jeton.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const attendu = signer(exp, auth.secret);
  return sig.length === attendu.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(attendu));
}

// Lecture des données (créées au premier appel).
async function lireDonnees(s) {
  const r = await s.getWithMetadata("data", { type: "json" });
  if (r) return { data: r.data, etag: r.etag };
  const data = donneesInitiales();
  const res = await s.setJSON("data", data, { onlyIfNew: true });
  if (res.modified) return { data, etag: res.etag };
  const r2_ = await s.getWithMetadata("data", { type: "json" });
  return { data: r2_.data, etag: r2_.etag };
}

// Modification sûre même si deux appareils écrivent en même temps.
async function modifier(s, fn) {
  for (let i = 0; i < 6; i++) {
    const { data, etag } = await lireDonnees(s);
    const resultat = fn(data);
    const res = await s.setJSON("data", data, { onlyIfMatch: etag });
    if (res.modified) return { data, resultat };
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 150));
  }
  throw new HttpError(409, "Trop de modifications simultanées, réessayez.");
}

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

// Opérations réservées au gestionnaire.
const OPS_ADMIN = {
  paiement(d, b) {
    trouverMembre(d, b.membreId);
    const montant = r2(Number(b.montant));
    if (!(montant > 0) || montant > 10000) throw new HttpError(400, "Montant invalide.");
    d.paiements.push({ id: uid(), membreId: b.membreId, montant, ts: Date.now() });
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
    const x = b.donnees;
    if (!x || !Array.isArray(x.membres) || !Array.isArray(x.consos) || !Array.isArray(x.paiements) || !x.prix)
      throw new HttpError(400, "Sauvegarde invalide.");
    d.membres = x.membres;
    d.consos = x.consos;
    d.paiements = x.paiements;
    d.prix = x.prix;
  },
};

export default async (req) => {
  try {
    const s = store();
    const route = new URL(req.url).pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // État complet (lecture libre sur la tablette).
    if (route === "etat" && req.method === "GET") {
      const { data } = await lireDonnees(s);
      return json(data);
    }

    // Un membre ajoute un café, une eau ou un soft. Prix et heure fixés par le serveur.
    if (route === "conso" && req.method === "POST") {
      if (!PRODUITS.includes(body.type)) throw new HttpError(400, "Type invalide.");
      const { data, resultat } = await modifier(s, (d) => {
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
      const { data } = await modifier(s, (d) => {
        const c = d.consos.find((x) => x.id === body.consoId && x.membreId === body.membreId);
        if (!c) throw new HttpError(404, "Consommation introuvable.");
        if (Date.now() - c.ts > DELAI_ANNULATION_MS) throw new HttpError(400, "Trop tard pour annuler.");
        d.consos = d.consos.filter((x) => x.id !== c.id);
      });
      return json({ etat: data });
    }

    const auth = await lireAuth(s);

    if (route === "info" && req.method === "GET") {
      return json({ mdpParDefaut: !!auth.parDefaut });
    }

    if (route === "login" && req.method === "POST") {
      const ok = hashMdp(String(body.motDePasse || ""), auth.sel) === auth.hash;
      if (!ok) {
        await new Promise((r) => setTimeout(r, 800)); // ralentit les essais au hasard
        throw new HttpError(401, "Mot de passe incorrect.");
      }
      return json({ jeton: creerJeton(auth), mdpParDefaut: !!auth.parDefaut });
    }

    // Tout ce qui suit demande une connexion gestionnaire.
    const jeton = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jetonValide(jeton, auth)) throw new HttpError(401, "Session expirée, reconnectez-vous.");

    if (route === "mdp" && req.method === "POST") {
      const nouveau = String(body.nouveau || "");
      if (nouveau.length < 4) throw new HttpError(400, "4 caractères minimum.");
      const sel = crypto.randomBytes(16).toString("hex");
      // Nouveau secret : toutes les autres sessions ouvertes sont déconnectées.
      const nouvelAuth = { sel, hash: hashMdp(nouveau, sel), secret: crypto.randomBytes(32).toString("hex"), parDefaut: false };
      await s.setJSON("auth", nouvelAuth);
      return json({ jeton: creerJeton(nouvelAuth) });
    }

    if (route === "admin" && req.method === "POST") {
      const op = OPS_ADMIN[body.op];
      if (!op) throw new HttpError(400, "Opération inconnue.");
      const { data } = await modifier(s, (d) => op(d, body));
      return json({ etat: data });
    }

    throw new HttpError(404, "Route inconnue.");
  } catch (e) {
    if (e instanceof HttpError) return json({ erreur: e.message }, e.status);
    console.error(e);
    return json({ erreur: "Erreur serveur." }, 500);
  }
};

export const config = { path: "/api/*" };
