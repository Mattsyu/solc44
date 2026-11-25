# Popotte café

Page tablette pour gérer la popotte café et boissons. Le site est hébergé gratuitement sur **Cloudflare Pages** ; les données sont enregistrées dans une base **Cloudflare D1**.

## Contenu du dépôt
- `public/index.html` : la page affichée sur la tablette.
- `functions/api/[[path]].js` : la fonction serveur (données, mots de passe), sous l'adresse `/api/…`.

Il n'y a rien à compiler : Cloudflare publie le dossier `public` et la fonction à chaque modification de la branche `main`.

## Mise en place sur Cloudflare (une seule fois)
1. Crée un compte sur dash.cloudflare.com et valide ton adresse e-mail.
2. **Base de données** : menu *Storage & databases* > *D1 SQL database* > *Create database*, nom `popotte`, puis *Create*.
3. **Site** : menu *Workers & Pages* > *Create application* > onglet ou lien *Pages* > *Import an existing Git repository*. Relie ton compte GitHub, choisis le dépôt `solc44`, puis *Begin setup*.
4. Réglages de construction :
   - *Production branch* : `main`
   - *Framework preset* : `None`
   - *Build command* : laisser vide
   - *Build output directory* : `public`
   - *Environment variables* : ajoute `SITE_PASSWORD` avec le mot de passe d'accès du site (coche *Encrypt*).
   Puis *Save and Deploy*.
5. **Relier la base** : dans le projet, *Settings* > *Bindings* > *Add* > *D1 database*. *Variable name* : `DB` (en majuscules), base : `popotte`. *Save*.
6. *Deployments* > sur le dernier déploiement, menu *…* > *Retry deployment*, pour que la base soit prise en compte.
7. Ouvre l'adresse `https://<nom-du-projet>.pages.dev`.

## Récupérer les données de l'ancien site Netlify
Sur le nouveau site : *Gestionnaire* (mot de passe `popotte` au premier lancement) > *Réglages* > « Récupérer les données de l'ancien site ».
Saisis le mot de passe d'accès de l'ancien site : membres, consommations, paiements, signalements et images sont copiés.
Le mot de passe gestionnaire, lui, n'est pas copié : change-le juste après dans *Réglages*.

Si l'ancien site ne répond plus, il reste la sauvegarde : sur l'ancien site, *Réglages* > « Télécharger une sauvegarde », puis sur le nouveau « Restaurer une sauvegarde… » (les images sont alors à remettre à la main).

## Mot de passe d'accès au site (obligatoire)
Le site demande un mot de passe dès l'ouverture, vérifié par le serveur : sans lui, aucune donnée n'est visible.
Ce mot de passe n'est **pas** dans le code (le dépôt GitHub est public). Il se règle sur Cloudflare :
*Settings* > *Variables and Secrets* > `SITE_PASSWORD`, puis relancer un déploiement (*Deployments* > *Retry deployment*).

Chaque appareil reste déverrouillé 90 jours. Pour le reverrouiller : *Gestionnaire* > *Réglages* > « Verrouiller cette tablette ».
Changer `SITE_PASSWORD` déverrouille tous les appareils, qui devront ressaisir le nouveau.

## Premier lancement
- Mot de passe gestionnaire par défaut : `popotte`. Change-le tout de suite dans *Gestionnaire > Réglages*.
  Tu peux aussi définir la variable `ADMIN_PASSWORD` sur Cloudflare **avant** le premier lancement.
- Membres de départ : Nicolas, Jean-Philippe, David, Fabrice, Christophe, Laurent, Anthony, Richard, François-Xavier, Matthieu, Florent, Damien, Patrice, et Benjamin (gestionnaire).
- Prix de départ : café 0,20 €, eau 0,50 €, soft 0,60 €.
- Noms et prix de départ : en haut de `functions/api/[[path]].js` (bloc `DEPART`). Ils ne servent qu'au tout premier lancement ; ensuite, tout se modifie dans l'espace Gestionnaire.

## Bouton « J'ai payé »
Sur son écran, un membre qui doit de l'argent peut appuyer sur « J'ai payé ». Le gestionnaire voit alors une pastille rouge sur le bouton « Gestionnaire » et une notification en haut de son espace. Il confirme (en corrigeant le montant si besoin) ou refuse. Une fois le paiement confirmé, la tuile du membre affiche « Payé ✓ ».

## Images des membres
*Gestionnaire* > *Membres* > « 🖼 Changer l'image » : choisis une photo sur l'appareil, elle est recadrée en carré et enregistrée sur Cloudflare. Sans image, la tuile affiche les initiales.

## Essayer en local (facultatif, avec Node.js)
```
echo "SITE_PASSWORD=essai" > .dev.vars
npx wrangler pages dev public --d1 DB=popotte
```
