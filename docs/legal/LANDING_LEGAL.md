# Brief légal — Landing page Atelier
**Version 1.0 — mai 2026**

> Ce document liste tout ce que la landing page doit contenir légalement, avec le texte exact à utiliser pour chaque élément. Il est en synergie avec l'app (même éditeur, mêmes textes sources dans legal.ts, mêmes liens).

---

## 1. Pages légales obligatoires à créer sur le site

Le site doit avoir ces 4 pages accessibles depuis le footer sur toutes les pages :

| Page | URL suggérée | Statut |
|---|---|---|
| Mentions légales | `/mentions-legales` | Obligatoire (LCEN art. 6) |
| Politique de confidentialité | `/confidentialite` | Obligatoire (RGPD art. 13) |
| Conditions Générales de Vente | `/cgv` | Obligatoire B2B (L.441-1 Code de commerce) |
| Cookies | Bandeau ou page `/cookies` | Obligatoire si cookies techniques |

---

## 2. Mentions légales — texte complet

```
MENTIONS LÉGALES

Éditeur du site
Samuel Mbeboura, entrepreneur individuel exerçant sous le nom commercial Orsayn
1 rue des héraults
SIRET : 98920815200011
Téléphone : 06 51 66 40 68
Email : contact@orsayn.fr
TVA non applicable — article 293 B du CGI

Directeur de la publication
Samuel Mbeboura

Hébergement
Cloudflare, Inc.
101 Townsend St, San Francisco, CA 94107, USA
cloudflare.com

Les données présentées sur ce site et collectées via les formulaires
sont hébergées sur l'infrastructure de Cloudflare, Inc. (exécution
applicative) et Supabase, Inc. (données, région EU West — Frankfurt,
Allemagne).
```

---

## 3. Politique de confidentialité — texte complet

```
POLITIQUE DE CONFIDENTIALITÉ

Dernière mise à jour : mai 2026

1. Qui traite vos données ?

Samuel Mbeboura, entrepreneur individuel exerçant sous le nom
commercial Orsayn (SIRET 98920815200011), est responsable du
traitement des données collectées sur ce site et dans l'application
Atelier pour ses propres traitements (gestion des contacts, support,
facturation, sécurité).

Pour les données métier saisies dans l'application par les artisans
(données de leurs propres clients, collaborateurs, chantiers), Orsayn
intervient comme sous-traitant au sens du RGPD. L'artisan est alors
responsable de traitement. Un accord de traitement des données (DPA)
est remis à chaque client lors du déploiement.

2. Quelles données sont collectées sur ce site ?

Formulaire de contact / demande de démo :
- Nom, prénom, email, téléphone, nom de l'entreprise
- Finalité : répondre à votre demande, vous contacter pour une démo
- Base légale : exécution de mesures précontractuelles (art. 6(1)(b) RGPD)
- Durée de conservation : 3 ans après le dernier contact

Données de navigation (logs serveur) :
- Adresse IP, type de navigateur, pages consultées, horodatage
- Finalité : sécurité, détection d'abus
- Base légale : intérêt légitime (art. 6(1)(f) RGPD)
- Durée de conservation : 1 an

3. Cookies

Ce site utilise uniquement des cookies techniques strictement
nécessaires au fonctionnement (maintien de session si espace
connecté). Aucun cookie publicitaire, aucun tracker tiers, aucune
régie publicitaire. Aucun consentement supplémentaire n'est requis
pour ces cookies fonctionnels (directive ePrivacy, art. 82 LIL).

4. Destinataires des données

Vos données peuvent être transmises aux prestataires techniques
suivants dans le cadre de la fourniture du service :

- Cloudflare, Inc. (USA) — exécution applicative. Certifié Data
  Privacy Framework UE-USA.
- Supabase, Inc. (USA, données stockées UE Frankfurt) — base de
  données. Certifié Data Privacy Framework UE-USA.
- Resend, Inc. (USA) — emails transactionnels. DPA RGPD, clauses
  contractuelles types.

Aucune vente de données à des tiers. Aucune utilisation à des fins
publicitaires.

5. Vos droits

Conformément au RGPD (articles 15 à 22), vous disposez des droits
suivants : accès, rectification, effacement, limitation, portabilité,
opposition.

Pour exercer vos droits : contact@orsayn.fr

Délai de réponse : 30 jours calendaires.

Si vous estimez que le traitement de vos données ne respecte pas le
RGPD, vous pouvez déposer une réclamation auprès de la CNIL :
cnil.fr/fr/plaintes

6. Autorité de contrôle

Commission Nationale de l'Informatique et des Libertés (CNIL)
3 Place de Fontenoy — TSA 80715 — 75334 PARIS CEDEX 07
www.cnil.fr
```

---

## 4. CGV — lien vers le document complet

La page `/cgv` du site doit reprendre intégralement le contenu de [docs/legal/CGV_ORSAYN.md](CGV_ORSAYN.md).

Points à vérifier pour l'intégration web :
- Le tableau des tarifs doit être à jour avec les prix HT en vigueur.
- La mention "TVA non applicable — article 293 B du CGI" doit apparaître clairement.
- Un lien vers la page `/cgv` doit figurer dans le footer ET sur la page de commande/devis avant toute signature.

---

## 5. Bandeau cookies — texte et comportement

Puisque le site n'utilise que des cookies techniques strictement nécessaires, **aucun bandeau de consentement n'est légalement requis** (directive ePrivacy transposée en art. 82 LIL, recommandation CNIL 2020-091).

Il suffit d'une mention dans la politique de confidentialité (voir section 3 ci-dessus) et dans le footer.

Texte footer suffisant :
```
Ce site utilise uniquement des cookies techniques nécessaires à son
fonctionnement. Aucun tracker publicitaire. En savoir plus →
[Confidentialité]
```

Si un jour un outil analytics tiers est ajouté (Plausible, GA, etc.), un bandeau de consentement devra être implémenté selon les recommandations CNIL en vigueur à ce moment.

---

## 6. Footer — éléments obligatoires

Le footer du site doit contenir au minimum :

```
© 2026 Orsayn — Samuel Mbeboura, EI — SIRET 98920815200011
TVA non applicable — art. 293 B du CGI

[Mentions légales]  [Confidentialité]  [CGV]  [Contact]
```

---

## 7. Formulaire de contact / demande de démo

Sous le bouton de soumission du formulaire, ajouter obligatoirement :

```
En soumettant ce formulaire, vous acceptez que vos coordonnées soient
utilisées pour vous recontacter dans le cadre de votre demande.
Consultez notre [politique de confidentialité] pour en savoir plus.
```

Ce texte satisfait à l'obligation d'information au moment de la collecte (RGPD art. 13).

---

## 8. Page pricing / tarifs — mentions légales à faire figurer

Sur toute page affichant les prix :

```
Tarifs affichés hors taxes (HT). TVA non applicable — article 293 B
du CGI. Les présentes offres sont soumises aux Conditions Générales
de Vente disponibles ici → [CGV].
```

Et en bas de la grille tarifaire :

```
Le setup est une prestation de déploiement one-shot. L'abonnement
mensuel IA est sans engagement minimum — résiliable à tout moment
avec 30 jours de préavis. Vos données vous appartiennent et vous
sont restituées en cas de résiliation.
```

---

## 9. Module e-facturation — mention obligatoire

Sur toute page ou section présentant la fonctionnalité de facturation électronique :

```
Atelier génère des factures au format Factur-X (norme EN 16931),
prêtes pour la réforme de facturation électronique obligatoire.

Atelier est un opérateur de dématérialisation (OD). En mode
B2Brouter, la transmission vers les plateformes est assurée par
B2Brouter, plateforme immatriculée PDP par la DGFiP. La
responsabilité de la conformité légale de la transmission incombe
à B2Brouter et au client. Pour les obligations spécifiques à votre
activité, consultez impots.gouv.fr.
```

---

## 10. Synergies avec l'application

Les textes ci-dessus sont alignés avec les constantes définies dans [src/lib/legal.ts](../../src/lib/legal.ts) :

| Élément landing | Source app |
|---|---|
| Nom éditeur, SIRET, adresse | `LEGAL_EDITOR.companyName`, `LEGAL_EDITOR.registration`, `LEGAL_EDITOR.address` |
| Hébergeurs (Cloudflare + Supabase) | `LEGAL_EDITOR.hostingProvider` |
| Emails de contact | `LEGAL_CONTACT.supportEmail`, `LEGAL_CONTACT.privacyEmail` |
| Durées de conservation | `DATA_RETENTION_TABLE` |
| Mention cookies | `LEGAL_COPY.cookies` |
| Texte propriété données / réversibilité | `PLATFORM_MODEL.dataTitle`, `PLATFORM_MODEL.dataBody` |

Si l'un de ces éléments change (adresse, email, hébergeur), mettre à jour `legal.ts` en premier — la landing doit s'aligner en conséquence.

---

## 11. Checklist avant mise en ligne

- [ ] Page `/mentions-legales` créée avec le texte section 2
- [ ] Page `/confidentialite` créée avec le texte section 3
- [ ] Page `/cgv` créée avec le contenu de CGV_ORSAYN.md
- [ ] Footer contient © + SIRET + 4 liens légaux (section 6)
- [ ] Formulaire de contact contient la mention RGPD (section 7)
- [ ] Page pricing contient les mentions HT + CGV + sans engagement (section 8)
- [ ] Section e-facturation contient la mention OD/PDP (section 9)
- [ ] Pas de bandeau cookies publicitaires (pas nécessaire, section 5)
- [ ] Vérification que tous les liens légaux du footer fonctionnent
