# Mode Joueur V2 — interaction native sur la carte

Le mode campagne ne remplace pas les menus d'Azgaar. La carte reste l'interface principale et les actions s'ouvrent dans les éditeurs natifs de l'application.

## Commandes globales
- Un petit HUD affiche l'horloge, la pause, la vitesse et le retour Sandbox.
- Le temps avance en continu ; l'économie et la démographie sont recalculées par jour de jeu.
- Le choix du pays est explicite et reste lié à la campagne.
- Le retour Sandbox conserve la sauvegarde et réactive les outils libres d'Azgaar.

## Clic sur une ville
- Le clic ouvre le véritable `BurgEditor` d'Azgaar.
- Les champs qui permettent de tricher gratuitement (nom, population, culture, bâtiments, suppression, déplacement administratif) sont verrouillés en campagne.
- Les décisions de jeu sont ajoutées à l'intérieur de cet éditeur : marché, développement urbain, remparts, citadelle et consultation de l'économie locale.
- Chaque chantier vérifie le propriétaire et débite le trésor avant de modifier la carte.

## Clic sur un territoire
- Le clic ouvre une fenêtre native Azgaar avec les caractéristiques de l'État.
- Pour l'État joueur : fiscalité, budget public et forces armées.
- Pour les autres États : alliance, commerce, paix, guerre et embargo.
- La compatibilité diplomatique s'appuie sur la culture, l'ascendance, le type culturel, la religion majoritaire, le régime, les voisins et les échanges.

## Armées
- Les symboles de régiment sur la carte ouvrent le véritable `RegimentEditor`.
- Les compositions libres sont verrouillées en campagne ; les recrutements passent par le registre militaire Azgaar, coûtent de l'argent et changent le vrai régiment.
- Une nouvelle unité est levée à la capitale, puis peut être recrutée.
- Un ordre de déplacement se termine par un clic sur la carte. Le moteur vérifie le propriétaire du territoire, le type terrestre/naval, la distance et le coût.
- Les déplacements libres par glisser-déposer restent disponibles en Sandbox.
- L'attaque utilise l'écran de bataille natif d'Azgaar.

## Règle de campagne
Les décisions sont vérifiées dans le moteur, et pas uniquement masquées dans l'interface : propriétaire de la ville, trésor disponible, composition, territoire accessible, type d'unité et coût de déplacement.

## À développer ensuite
- Trajets militaires en plusieurs étapes avec ravitaillement, fatigue et délai.
- Recrutement limité par la population mobilisable et la capacité économique.
- Actions propres aux régimes : décrets théocratiques, privilèges claniques, institutions républicaines, etc.
- Événements locaux déclenchés par la culture, la religion, les ressources et les bâtiments de la ville.
