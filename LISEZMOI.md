# Popotte café

Page tablette pour gérer la popotte café et boissons. Les données sont enregistrées sur Netlify (Netlify Blobs).

## Contenu du dossier
- `public/index.html` : la page affichée sur la tablette.
- `netlify/functions/api.mjs` : la fonction serveur (données, mot de passe gestionnaire).
- `netlify.toml`, `package.json` : configuration Netlify.

## Déployer
Le simple glisser-déposer (Netlify Drop) ne prend pas en charge les fonctions. Deux façons de faire :

**A. Avec un dépôt GitHub (le plus simple à maintenir)**
1. Crée un dépôt GitHub et dépose-y le contenu de ce dossier (sur github.com : *Add file* > *Upload files*, puis glisse les fichiers et dossiers décompressés, en gardant `netlify/functions/api.mjs` et `public/index.html` à leur place).
2. Sur app.netlify.com : *Add new project* > *Import an existing project* > GitHub > choisis le dépôt.
3. Laisse les réglages proposés (ils viennent de `netlify.toml`) et clique sur *Deploy*.

**B. Avec la ligne de commande Netlify (Node.js installé sur ton ordinateur)**
```
cd popotte
npm install
npx netlify-cli login
npx netlify-cli deploy --prod
```

## Mot de passe d'accès au site (obligatoire)
Le site demande un mot de passe dès l'ouverture, vérifié par le serveur : sans lui, aucune donnée n'est visible.
Ce mot de passe n'est **pas** dans le code (le dépôt GitHub est public). Il se règle sur Netlify :
1. *Project configuration* > *Environment variables* > *Add a variable*.
2. Clé : `SITE_PASSWORD`, valeur : le mot de passe choisi.
3. *Deploys* > *Trigger deploy* > *Deploy project* pour qu'il soit pris en compte.

Chaque appareil reste déverrouillé 90 jours. Pour le reverrouiller : *Gestionnaire* > *Réglages* > « Verrouiller cette tablette ».
Changer `SITE_PASSWORD` (puis redéployer) déverrouille tous les appareils, qui devront ressaisir le nouveau.

## Premier lancement
- Mot de passe gestionnaire par défaut : `popotte`. Change-le tout de suite dans *Gestionnaire > Réglages*.
  Tu peux aussi définir la variable d'environnement `ADMIN_PASSWORD` sur Netlify **avant** le premier lancement.
- Membres de départ : Nicolas, Jean-Philippe, David, Fabrice, Christophe, Laurent, Anthony, Richard, François-Xavier, Matthieu, Florent, Damien, Patrice, et Benjamin (gestionnaire).
- Prix de départ : café 0,20 €, eau 0,50 €, soft 0,60 €.
- Noms et prix de départ : en haut de `netlify/functions/api.mjs` (bloc `DEPART`). Ils ne servent qu'au tout premier lancement ; ensuite, tout se modifie dans l'espace Gestionnaire.

## Bouton « J'ai payé »
Sur son écran, un membre qui doit de l'argent peut appuyer sur « J'ai payé ». Le gestionnaire voit alors une pastille rouge sur le bouton « Gestionnaire » et une notification en haut de son espace. Il confirme (en corrigeant le montant si besoin) ou refuse. Une fois le paiement confirmé, la tuile du membre affiche « Payé ✓ ».

## Images des membres
*Gestionnaire* > *Membres* > « 🖼 Changer l'image » : choisis une photo sur l'appareil, elle est recadrée en carré et enregistrée sur Netlify. Sans image, la tuile affiche les initiales.
