# Mode Joueur V2 — cahier de conception

La V2 doit être une vraie couche de jeu sur la carte Azgaar, pas un tableau de bord posé à côté.

## Déjà intégré dans cette branche

- La campagne commence par un écran de sélection du pays.
- Le pays choisi est enregistré dans la campagne et ne peut plus être changé depuis le sélecteur de l'interface.
- La sélection n'est pas automatiquement remplacée par le premier pays de la carte après un chargement.
- Depuis la liste des villes, le bouton « Ouvrir l'éditeur Azgaar » ouvre le véritable `BurgEditor` natif d'Azgaar.
- Le panneau du mode joueur est agrandi et adapté à une campagne.

## Fonctionnalités V2 à construire ensuite

### Carte et interface de campagne
- La carte reste la surface de jeu principale.
- Un menu de campagne dédié organise les ordres par domaine : État, villes, économie, routes, diplomatie et forces territoriales.
- Les outils de création de monde (régénération, modification libre des États, édition globale des frontières et outils de génération) sont masqués pendant une campagne. Les outils de consultation restent accessibles.
- Les modifications autorisées passent par les ordres du joueur, avec contrôle du pays propriétaire, du prix et des conséquences.

### Villes
- Réutiliser le vrai éditeur natif Azgaar pour les données de ville.
- Les actions qui améliorent une ville doivent être des projets payants, avec coût initial, délai et entretien éventuel.
- La population des villes doit évoluer à chaque tour en fonction de la prospérité, des ressources, des infrastructures et des événements. Ne pas permettre une croissance gratuite par simple édition.
- Une modification administrative d'une ville doit être vérifiée et débitée avant d'être appliquée.

### Routes et cellules
- Mode « Tracer une route » : cliquer sur une cellule de départ, puis sur chaque cellule voisine du tracé, puis sur la cellule d'arrivée.
- Afficher le tracé provisoire et son coût estimé avant confirmation.
- Refuser les cellules maritimes impraticables et les territoires étrangers sans accord.
- À la confirmation, créer la vraie route Azgaar à partir de la séquence de cellules et débiter le trésor.

### Diplomatie
- Choisir un pays sur la carte ou dans la liste des États.
- Afficher ses frontières, son attitude, les traités et les intérêts économiques.
- Les propositions ont un coût et une réponse de l'IA ; elles ne modifient pas la carte avant acceptation.

### Forces territoriales
- Gestion abstraite de présence et de contrôle de cellules, de budgets, d'entretien et d'approvisionnement à l'échelle du jeu.
- Les ordres passent par une sélection de cellules sur la carte et restent soumis aux frontières, aux coûts et aux règles de campagne.
- Pas de simulation de tactiques réelles ni de détails d'armes : la résolution reste une mécanique stratégique abstraite.

## Règle anti-triche

Une campagne garde un identifiant de pays joueur immuable. Les actions sont validées dans le moteur, pas seulement dans l'interface : propriété des cellules, fonds disponibles, coûts, limites de déplacement abstraites et état des traités. Masquer un bouton ne suffit pas à sécuriser une action.

## Critère d'acceptation

Une V2 n'est pas considérée terminée tant qu'un joueur ne peut pas démarrer une carte, choisir son pays une seule fois, tracer une route en cliquant les cellules réelles, payer une amélioration urbaine, faire évoluer la population au fil des tours et conduire les relations avec les autres États depuis la carte.
