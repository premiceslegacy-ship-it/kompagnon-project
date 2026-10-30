# Contraintes tarifaires Supabase, faits vérifiés

Vérifié le 2026-09-09 sur la documentation officielle Supabase. Ce qui suit corrige une hypothèse fausse tenue un temps dans cette même discussion (« 2 projets Free par organisation, créer plusieurs organisations débloque le quota ») : l'inverse est vrai, et c'est documenté explicitement par Supabase.

## Le quota Free réel

> « The project limit applies across all organizations where you are an Owner or Administrator. This means you could have two Free Plan organizations with one project each, or one Free Plan organization with two projects. »
>
> Source : [Billing on Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase)

**2 projets Free actifs par compte utilisateur, toutes organisations confondues.** Multiplier les organisations ne débloque rien : Supabase compte le quota sur l'utilisateur (Owner ou Admin), pas sur l'organisation. C'est une fermeture délibérée du contournement le plus évident.

Point secondaire : les projets **en pause** ne comptent pas dans ce quota. Mais les instances clientes d'Atelier sont maintenues actives par un cron keep-alive quotidien (`workers/data-retention/`, décrit dans `src/app/api/cron/data-retention/route.ts`) : sans ce mécanisme, la pause à 7 jours d'inactivité rendrait le service indisponible pour un client qui n'ouvre pas son espace une semaine, inacceptable sur une prestation facturée. Le cron reste donc nécessaire, ce qui neutralise l'avantage du quota sur les projets en pause.

## Le plan Pro

25 $/mois, mais ce n'est **pas** un tarif tout compris pour plusieurs projets. Le plan inclut 10 $/mois de crédits de compute, qui couvrent une seule instance Micro. **Chaque projet supplémentaire consomme du compute facturé en plus** : c'est ce coût marginal par projet, et non l'abonnement de base, qui rend le Pro inadapté tel quel au modèle un-projet-Supabase-par-client : le coût croît avec le nombre de clients, sans plafond évident.

Le coût exact de ce compute additionnel par projet n'a pas été vérifié en détail (dépend du dimensionnement choisi par projet) : à faire si l'option Pro est reconsidérée sérieusement avant la bascule VPS.

## Ce qui a motivé la décision retenue

Sur une prestation setup facturée 3 000 €, le montant du plan Pro (25 $/mois, avant même le compute additionnel) représente moins de 1 % du revenu d'un seul client. L'économie réelle à chercher n'est pas là. Deux options concurrentes ont été écartées pour cette raison :

- **Rester indéfiniment sur des comptes Free multiples** : viable à très petite échelle (2 à 4 clients), mais c'est un contournement des CGU Supabase, pas un modèle pérenne. Le risque n'est pas financier mais opérationnel : une suspension de compte tomberait sur les bases de clients payants, pas sur un projet de test.
- **Passer au plan Pro comme solution structurelle** : évite le contournement CGU mais introduit un coût qui grandit avec chaque client, sans qu'on connaisse encore le point où il devient significatif.

D'où la trajectoire retenue dans [03-trajectoire.md](03-trajectoire.md) : amorçage borné sur Free, puis bascule vers un self-hosted qui évite les deux écueils.

## Sources

- [Billing on Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase) : quota de projets Free, comportement multi-organisations.
- [Billing FAQ](https://supabase.com/docs/guides/platform/billing-faq)
- [Pricing](https://supabase.com/pricing) : tarif Pro et crédits de compute inclus.

Ces pages évoluent avec l'offre Supabase : si la bascule est repoussée de plusieurs mois, revérifier avant de trancher définitivement.
