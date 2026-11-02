# Qualification de la refonte Atelier

## Périmètre

Les six parcours de `e2e/daily-workflows.spec.ts` utilisent l’interface réelle, les Server Actions réelles et un Supabase local migré :

- créer un devis, puis vérifier ses lignes et ses montants en base ;
- l’envoyer, capturer le message au bon destinataire et son PDF ;
- facturer un devis accepté en conservant le client, les montants et les instantanés ;
- ajouter un client par le formulaire métier ;
- signer un devis comme destinataire, puis vérifier l’accord et les montants persistés ;
- saisir des heures depuis l’espace intervenant, puis retrouver le pointage en base et dans l’interface.

Les lignes de section d’une facture, encodées avec l’unité `__section__`, ne sont pas des lignes facturables. L’appartenance d’un pointage est vérifiée via son chantier, conformément à la mutation existante, et non via la colonne historique nullable `organization_id` du pointage.

Pour la facture émise, les quantités, prix unitaires et taux de TVA sont comparés à l’instantané `issuance_snapshot`, avec le client et les totaux HT/TVA/TTC. L’ancien champ cache `invoice_items.total_ht` ne remplace pas cette autorité métier.

Aucune mutation métier n’est remplacée par un mock. Les identités, organisations et documents restent fictifs et portent le marqueur Qualification.

## Confidentialité avant hydratation

`e2e/auth-transport.spec.ts` coupe JavaScript et capture la requête native du navigateur pour les formulaires de connexion et d’inscription. Il vérifie le transport POST et l’absence d’identifiants dans l’URL. La réponse est interceptée pour ne pas exécuter une création de compte : ce test couvre le transport des identifiants, pas une authentification sans JavaScript.

Le correctif correspondant est exclusivement côté formulaire : `method="post"`. Les actions serveur de connexion et d’inscription ne changent pas.

L’ancienne suite `einvoicing-settings.spec.ts` a été remplacée : son assertion utile d’accès à la configuration pour un propriétaire autorisé est conservée avec une fixture locale, sans identifiants de démonstration. Le scénario vide ignoré, le contrôle sur un identifiant absent du produit et les assertions de câblage OAuth ont été retirés. Ce test d’accès ne prouve ni une connexion Super PDP réelle ni une délivrabilité réelle des e-mails.

L’ancien script public contenait aussi des replis d’identifiants de démonstration en clair. Le nouveau test n’en utilise aucun, mais leur suppression du fichier ne les retire pas de l’historique public. Leur validité n’a pas été testée en production ; s’ils sont encore actifs, ils doivent être révoqués ou changés côté authentification. Aucun essai de connexion en production ni aucune rotation n’a été effectué dans ce lot.

## Environnement obligatoire

Exécuter depuis un worktree dédié sans `.env`, `.env.local` ou variante chargée par Next. Le lanceur refuse ces fichiers ; il ne faut pas supprimer ceux du dossier de travail habituel pour contourner cette protection.

Utiliser un projet Supabase **local et explicitement identifié**, avec les migrations de l’app. Les clés doivent provenir de ce projet local, jamais du projet de production ni d’un autre client. Le cockpit exige une seconde base avec ses propres migrations.

Variables du processus de qualification :

- `SUPABASE_URL` : origine HTTP loopback de l’API locale ;
- `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` : clés de cette même stack locale ;
- `E2E_BASE_URL` : origine `http://localhost` avec un port explicite libre ;
- `E2E_EMAIL_SINK_URL` : origine HTTP loopback avec un port libre et le chemin `/v1`, par défaut `http://127.0.0.1:43127/v1`.

Employer **localhost pour l’origine de l’app**. La version de Next utilisée normalise `127.0.0.1` en `localhost` dans `NextRequest.url` ; mélanger les deux hôtes lors d’une redirection ferait perdre la portée du cookie intervenant.

Une fois ces variables locales définies :

```sh
npm run test:e2e
```

Playwright lance `scripts/e2e-qualification-server.mjs`, qui lance Next, fournit des secrets éphémères de session et de rate limiting, distincts de la clé de service, et intercepte Resend vers un sink en mémoire. Les gardes de production restent actives. Le sink accepte uniquement des destinataires `.test`. Les captures e-mail sont effacées entre les scénarios. Chaque scénario crée et supprime uniquement son organisation et son compte générés.

Pour qualifier le rendu de production local, compiler d’abord avec le même environnement isolé, puis lancer les parcours sur ce build :

```sh
node ./scripts/e2e-qualification-server.mjs --build
E2E_NEXT_SERVER_MODE=start npm run test:e2e
```

Le premier appel réutilise le nettoyage d’environnement, les clés locales, le faux fournisseur e-mail et le garde réseau du lanceur ; il ne déploie rien. Le build contient des URL et clés publiques de qualification : ne jamais le publier ni réutiliser un build configuré pour une autre instance. Sans `E2E_NEXT_SERVER_MODE=start`, la qualification continue de lancer le mode développement.

La préparation locale d’une route et sa capture doivent attendre le contenu rendu et le thème effectivement appliqué, pas un silence réseau global : les requêtes de fond et les recompilations du serveur de développement ne définissent pas la disponibilité de l’interface. Une capture claire ne doit jamais être comptée comme une preuve sombre.

Le garde réseau du processus Next refuse les destinations non loopback et les redirections automatiques de fetch. La régression `e2e-network-guard.test.ts` couvre les sockets normalisées de Node et le résolveur DNS asynchrone avec des sentinelles qui empêchent tout accès réseau réel, même en cas de régression. Ce dispositif n’est pas présenté comme un bac à sable réseau au niveau du système d’exploitation.

Les traces, vidéos et captures automatiques Playwright sont désactivées. Ne pas publier les dossiers `test-results`, les profils du navigateur ou les journaux bruts : les contextes d’erreur du framework peuvent contenir des liens de capacité locaux. Les rapports de qualification doivent être expurgés.

## Contrôles et séquencement

Le même plafond mémoire que la CI est utilisé pour les contrôles :

```sh
NODE_OPTIONS=--max-old-space-size=6144 npm run check
```

Sur le poste de qualification de 8 Go, lancer les deux versions de Next **successivement**, pas simultanément. Les ports de l’app et du sink doivent être distincts pour une comparaison avant/après. Deux instances Next du même worktree partageraient également son verrou `.next/dev`.

Les captures visuelles doivent couvrir clair/sombre, 360/390/768/1280, les écrans atteignables, les états vides et les libellés longs. Vérifier le clavier, le mouvement réduit, le débordement et le premier affichage sombre dans un vrai navigateur. Les tests métier ne remplacent pas cette vérification.

## Production

Ne pas fusionner dans `main` sans autorisation de déploiement : les workflows existants déploient automatiquement Atelier et le cockpit après une CI réussie sur un push de `main`. Les PRs de refonte doivent passer par une branche d’intégration tant que cette autorisation n’est pas donnée. Une validation de phase n’est pas, à elle seule, une autorisation de déploiement.
