# Popotte café

Page tablette pour gérer la popotte café et boissons. Les données sont enregistrées sur Netlify (Netlify Blobs).

## Contenu du dossier
- `public/index.html` : la page affichée sur la tablette.
- `netlify/functions/api.mjs` : la fonction serveur (données, mot de passe gestionnaire).
- `netlify.toml`, `package.json` : configuration Netlify.

## Déployer
Le simple glisser-déposer (Netlify Drop) ne prend pas en charge les fonctions. Deux façons de faire :

**A. Avec un dépôt GitHub (le plus simple à maintenir)**
1. Crée un dépôt GitHub et mets-y le contenu de ce dossier.
2. Sur app.netlify.com : *Add new project* > *Import an existing project* > GitHub > choisis le dépôt.
3. Laisse les réglages proposés (ils viennent de `netlify.toml`) et clique sur *Deploy*.

**B. Avec la ligne de commande Netlify (Node.js installé sur ton ordinateur)**
```
cd popotte
npm install
npx netlify-cli login
npx netlify-cli deploy --prod
```

## Premier lancement
- Mot de passe gestionnaire par défaut : `popotte`. Change-le tout de suite dans *Gestionnaire > Réglages*.
  Tu peux aussi définir la variable d'environnement `ADMIN_PASSWORD` sur Netlify **avant** le premier lancement.
- Noms et prix de départ : en haut de `netlify/functions/api.mjs` (bloc `DEPART`). Ils ne servent qu'au tout premier lancement ; ensuite, tout se modifie dans l'espace Gestionnaire.
