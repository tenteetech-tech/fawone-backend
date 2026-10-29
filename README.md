# FAWONE — Backend (API Node.js + SQLite)

API REST de FAWONE Community : serveur `node:http`, base SQLite, cryptographie `node:crypto`.

## Prérequis

- **Node.js 22.13+ (recommandé)** : SQLite est intégré à Node (`node:sqlite`), rien à installer.
- **Node.js 20** : `npm install` installe `better-sqlite3`, utilisé automatiquement à la place.

Le moteur utilisé s'affiche au démarrage : `(SQLite : node:sqlite)` ou `(SQLite : better-sqlite3)`.

## Démarrer

```bash
cp .env.example .env      # puis renseignez ADMIN_EMAIL / ADMIN_PASSWORD
npm install               # nécessaire sous Node 20 (installe better-sqlite3)
npm run dev               # http://127.0.0.1:4000 (redémarre à chaque modification)
```

La base `data/fawone.db` est créée **vide** au premier lancement.

Pour créer la première super administratrice :

- automatiquement au démarrage, si `ADMIN_EMAIL` et `ADMIN_PASSWORD` sont définis dans `.env` ;
- ou avec la commande : `npm run create-admin -- --email presidente@fawone.org --first-name Esther --last-name Mbianda --branch Buea` (le mot de passe est demandé).

Elle se connecte ensuite sur le frontend (`/admin/login`) pour créer les branches, les membres, les projets…

| Commande | Rôle |
|---|---|
| `npm run dev` | développement (rechargement automatique) |
| `npm start` | production |
| `npm test` | 25 tests d'intégration (sur une base temporaire) |
| `npm run create-admin` | crée une super administratrice |
| `npm run whatsapp:groups` | liste les groupes WhatsApp du numéro relié (pour `WHATSAPP_GROUP_ID`) |
| `npm run seed:demo -- --force` | *facultatif* : **remplace** tout le contenu par des données fictives (pour une présentation) |

## Dons Mobile Money avec Campay (MTN MoMo et Orange Money)

Les dons passent **uniquement** par [Campay](https://www.campay.net), avec MTN Mobile Money ou Orange Money (pas de carte, PayPal ni autre moyen). Sans identifiants Campay, les dons en ligne sont désactivés.

**Déroulement d'un don**

1. La donatrice choisit MTN Mobile Money ou Orange Money et saisit son numéro (`6XXXXXXXX`). Le serveur vérifie que le numéro correspond bien à l'opérateur choisi.
2. L'API crée le don **en attente** et appelle `POST /api/collect/` chez Campay. La donatrice reçoit une demande sur son téléphone ; sinon, le code USSD (`*126#`, `#150*50#`…) s'affiche à l'écran.
3. Elle valide avec son code secret. Le statut est **toujours relu chez Campay** (`GET /api/transaction/{référence}/`), jamais pris tel quel depuis le navigateur ou le webhook. Trois mécanismes déclenchent cette vérification :
   - la page de paiement, toutes les 4 secondes ;
   - le webhook Campay ;
   - une tâche de fond, toutes les 2 minutes.
4. Le don est **confirmé une seule fois**. À ce moment :
   - le reçu est créé ;
   - le montant collecté du projet augmente ;
   - le message WhatsApp part dans le groupe.

   En cas de refus ou de solde insuffisant, le don passe « échoué » avec le motif. Sans validation au bout de 30 minutes, il passe « annulé ».

**Ce qui est vérifié**

- Montant reçu inférieur au montant demandé → don refusé.
- Numéro de téléphone stocké masqué (`6•••••456`).
- Le code secret ne transite jamais par FAWONE.

**Mise en place**

1. Créez un compte sur https://www.campay.net, puis une **application**. Récupérez l'*App Username* et l'*App Password* (onglet API).
2. Dans `.env` :

   ```
   CAMPAY_ENV=demo
   CAMPAY_USERNAME=…
   CAMPAY_PASSWORD=…
   ```

3. Redémarrez l'API. Le terminal doit afficher `[campay] Paiements Mobile Money actifs (démo)`.
4. Faites un don test avec **un petit montant**. L'environnement de démo de Campay limite les montants (environ 100 FCFA) et ne débite pas réellement.
5. **Webhook** (recommandé en production) : dans l'application Campay, déclarez l'URL `https://<votre-api>/api/payments/campay/webhook`. Sans webhook, par exemple en local, la page de paiement et la tâche de fond suffisent.
6. **Passage en production** :
   - `CAMPAY_ENV=live` et les identifiants de l'application *live* ;
   - compte Campay validé (KYC) ;
   - `NODE_ENV=production` et HTTPS.

Campay prélève une commission sur chaque transaction ; vérifiez les tarifs sur votre compte. Pour reverser les fonds, utilisez votre tableau de bord Campay.

## Notifications WhatsApp (groupe de l'association)

Messages envoyés automatiquement dans le groupe WhatsApp :

- 🌱 nouveau projet ;
- 📅 nouvel événement ;
- 📰 actualité publiée (pas les brouillons) ;
- 💚 don confirmé, avec le total collecté.

Les montants sont en FCFA, avec un lien vers l'application. L'administration (**Notifications**) affiche l'historique, l'état de chaque envoi et un bouton « Renvoyer ».

**Pourquoi un fournisseur ?** L'API officielle de Meta ne permet pas de publier dans un groupe existant de la communauté. On relie donc un numéro WhatsApp à un service comme **Green-API** ou **Whapi.Cloud** (offres gratuites pour tester). Utilisez un **numéro dédié à l'association** : ces services ne sont pas officiels, et WhatsApp peut restreindre un numéro qui envoie beaucoup de messages.

### Configuration avec Whapi.Cloud

1. Créez un compte sur [panel.whapi.cloud](https://panel.whapi.cloud/register), puis ouvrez le canal d'essai (ou le canal de l'association).
2. Sur la page du canal, affichez le QR code. Dans WhatsApp sur le téléphone du numéro de l'association, ouvrez **Paramètres → Appareils connectés → Connecter un appareil** et scannez-le. Le numéro doit aussi avoir rejoint le groupe cible.
3. Toujours sur la page du canal, copiez la **clé API / API token**. C'est cette valeur qui va dans `WHAPI_TOKEN`. Il n'y a pas d'`Instance ID` Whapi à récupérer.
4. Dans le `.env` du backend, renseignez le fournisseur et le jeton :

   ```env
   WHATSAPP_PROVIDER=whapi
   WHAPI_TOKEN=collez_ici_le_jeton_du_canal
   WHATSAPP_GROUP_ID=
   ```

   L'URL `https://gate.whapi.cloud` est utilisée par défaut ; définissez `WHAPI_API_URL` seulement si votre compte vous indique une autre URL.
5. Depuis le dossier `backend`, exécutez `npm run whatsapp:groups`. La commande interroge le canal et affiche les groupes accessibles. Copiez l'identifiant du groupe choisi, qui se termine par `@g.us`, dans `WHATSAPP_GROUP_ID`. Cet identifiant est celui du groupe, pas celui du canal ni le numéro de téléphone.
6. Redémarrez l'API. Dans l'administration, ouvrez **Notifications** et cliquez sur **Envoyer un message de test**.

Gardez `WHAPI_TOKEN` secret : ne le mettez jamais dans le frontend, dans un dépôt Git ou dans un message partagé. Le backend ajoute lui-même le préfixe d'autorisation requis par Whapi.Cloud. Pour un numéro dédié à l'association, ouvrez régulièrement WhatsApp sur le téléphone afin de maintenir la session active.

Pour Green-API, choisissez `WHATSAPP_PROVIDER=greenapi` et renseignez `GREENAPI_ID_INSTANCE` ainsi que `GREENAPI_API_TOKEN`.

`WHATSAPP_PROVIDER=console` affiche les messages dans le terminal, sans rien envoyer : pratique pour essayer.

## Organisation

```
src/
  server.js            serveur HTTP, CORS facultatif, gestion des erreurs
  config.js            variables d'environnement (.env)
  db/
    schema.sql         tables, contraintes, index
    driver.js          choix du moteur : node:sqlite ou better-sqlite3
    index.js           connexion SQLite, helpers SQL, conversion en JSON
    admins.js          création de la super administratrice
    seed-demo.js       jeu de démonstration (facultatif, utilisé par les tests)
  services/
    whatsapp.js        envoi au groupe WhatsApp (Green-API / Whapi), journal, messages
    campay.js          client Campay (jeton, collect, statut), numéros camerounais
    payments.js        vérification et confirmation des paiements, expiration
  auth/
    session.js         sessions (cookie httpOnly), limitation des tentatives
    permissions.js     rôles et périmètre par branche
  lib/
    http.js            routeur, JSON, cookies, validation
    security.js        scrypt, jetons, règles de mot de passe
  routes/              auth, bootstrap, members, branches, invitations, projects, donations, content
scripts/               create-admin.js, seed-demo.js
seed/demo.json         données fictives (uniquement pour seed:demo et les tests)
test/                  tests node:test
```

## Sécurité

- **Mots de passe** hachés avec scrypt et un sel aléatoire. Règle : 8 caractères minimum, avec au moins une lettre et un chiffre.
- **Session** : jeton aléatoire dans un cookie `httpOnly` et `SameSite=Lax` (`Secure` en production). En base, seule son empreinte SHA‑256 est stockée.
- **Tentatives** : 5 échecs de connexion bloquent 15 minutes (par IP et e-mail). Les demandes de « mot de passe oublié » sont limitées de la même façon.
- **CSRF** : l'API n'accepte que du JSON.
- **Droits** : vérifiés sur chaque route. Les coordonnées privées sont retirées des réponses, et les administratrices de branche sont limitées à leur branche.
- **Montants** : stockés en centimes. Le montant collecté d'un projet est calculé à partir des dons confirmés.

## API

```
GET  /api/health
GET  /api/auth/me                     POST /api/auth/login | logout | forgot | reset | change-password
GET  /api/auth/invitation/:token      POST /api/auth/accept-invitation
GET  /api/bootstrap                   (données visibles par la personne connectée)
PATCH /api/members/me   POST /api/members   PATCH /api/members/:id   POST /api/members/import
POST /api/branches
POST /api/invitations   PATCH /api/invitations/:id   POST /api/invitations/:id/link
POST /api/projects      PUT /api/projects/:id        POST /api/projects/:id/updates
POST /api/donations     POST /api/donations/manual   PATCH /api/donations/:id
GET  /api/donations/:id/status       POST /api/donations/:id/refresh
GET|POST /api/payments/campay/webhook
POST /api/news          PUT /api/news/:id            POST /api/events   POST /api/notifications
```

## Pas encore branché

- **E-mails / SMS** : les liens d'invitation et de réinitialisation sont affichés dans la console. En développement, ils sont aussi renvoyés au frontend.

## Production

- Définir `NODE_ENV=production`.
- Mettre l'API derrière HTTPS.
- Sauvegarder régulièrement `data/fawone.db`.
- Ne pas exposer le port 4000 publiquement si le frontend joue le rôle de proxy.
