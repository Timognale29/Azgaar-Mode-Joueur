# Mode joueur — première version jouable

Cette documentation décrit l'implémentation ajoutée sur la branche `mode-joueur-dev`.

## Démarrer une campagne

1. Ouvrir Azgaar avec une carte générée ou chargée.
2. Cliquer sur **JOUER**.
3. Choisir l'État que l'on souhaite diriger.
4. Utiliser **Tour suivant** pour lancer le premier cycle économique.

La campagne initialise une trésorerie de départ de 1 500 unités monétaires par État, enregistrée dans le navigateur. À chaque tour, le trésor évolue ensuite du solde net calculé par le moteur économique d'Azgaar.

## Ce qu'un tour fait

Un tour appelle `Production.regenerate()`, le véritable cycle économique d'Azgaar. Il recalcule notamment :

- la production des villes et des campagnes ;
- les achats d'ingrédients, les ventes, les stocks de marchés et les échanges ;
- les impôts sur les ventes, les impôts par habitant et les tarifs ;
- les commandes publiques correspondant aux budgets de cour, d'administration, d'infrastructures et de défense.

Après ce cycle, le moteur de campagne crédite ou débite chaque trésor du solde net quotidien. Il fait évoluer les populations rurales et urbaines en fonction de la prospérité mesurée, puis exécute les réactions diplomatiques et économiques des IA.

## Coûts des projets et missions

Les prix sont débités avant la réalisation. Un projet qui ne peut pas être financé est refusé et ne modifie pas la carte.

| Action | Coût |
| --- | ---: |
| Dotation initiale de campagne | 1 500 par État |
| Construire un marché | 260 + 0,08 par habitant de la ville |
| Entretien d'un marché | 4 par tour |
| Construire une route | 90 + 1,8 par unité de longueur terrestre du tracé |
| Entretien d'une route | 0,08 par unité de longueur, minimum 1 par tour |
| Mission diplomatique (alliance, commerce ou paix) | 65 |
| Mobilisation pour déclarer un conflit | 240 |
| Entretien militaire | 35 + 0,8 × racine carrée de la population en points, plafonné à 180 par camp et par tour |
| Mise en place d'un embargo | 85 |

Les frais d'entretien peuvent faire passer le trésor en négatif : cette dette bloque les nouveaux chantiers tant que les fonds ne sont pas revenus au-dessus du coût demandé.

Les travaux créent des données réelles dans la carte : les marchés sont ajoutés au modèle commercial et les routes sont ajoutées au réseau de transport utilisé pour calculer les coûts d'acheminement.

## Économie et fiscalité

L'onglet **Finances** permet de modifier :
- la taxe sur les ventes (taux de 0 à 30 %) ;
- l'impôt par habitant (montant par personne) ;
- les parts de budget consacrées à la cour, à l'administration, aux infrastructures et à la défense.

Les taux et budgets sont appliqués au prochain cycle. Les dépenses d'infrastructure sont des commandes publiques : le moteur d'Azgaar achète les biens requis sur les marchés et enregistre ce qui a effectivement été dépensé. Elles ne créent donc pas des bâtiments gratuitement.

## Commerce

L'onglet **Commerce** lit les résultats du moteur existant : exportations, importations, partenaires, production de ressources, marchés, stocks visibles et routes. Les prix, stocks et échanges sont recalculés à chaque tour.

## IA des États

Les relations sont évaluées à partir de la culture commune, du voisinage, des échanges commerciaux et de la relation en cours. L'IA peut faire évoluer ses attitudes (amicale, alliée, soupçonneuse ou rivale).

Les gouvernements IA réagissent aussi à leur solde et à la prospérité : ils peuvent augmenter leurs impôts en cas de déficit, réduire certaines dépenses, ou donner davantage de moyens aux infrastructures lorsque la population est peu prospère. En guerre, ils renforcent leur budget de défense.

## Diplomatie

Les actions disponibles sont :
- alliance défensive ;
- traité commercial ;
- traité de paix ;
- déclaration de conflit ;
- embargo.

Les alliances et les accords commerciaux retirent les tarifs ciblés entre les deux partenaires. Les conflits restent abstraits à ce stade : les relations, les embargos et la paix sont gérés, mais il n'y a pas encore de simulation de batailles ni de campagnes militaires.

## Assistant

L'onglet **Assistant** propose un interpréteur local d'ordres en français. Quand un fournisseur IA est déjà connecté dans l'assistant Azgaar, il propose aussi un conseiller génératif capable d'utiliser une liste fermée d'outils de campagne (lecture du trésor, fin de tour, construction, fiscalité, budget, négociation et embargo). Il ne peut pas exécuter de code arbitraire.

Le conseiller utilise la clé et le fournisseur enregistrés dans le navigateur par Azgaar. Les fournisseurs externes peuvent facturer leurs requêtes ; une connexion ChatGPT Plus n'est pas une clé API OpenAI. Ne partage pas de clé API dans la conversation.

- `construis un marché à [ville]`
- `construis une route entre [ville] et [ville]`
- `construis une route vers [ville]`
- `taxe sur les ventes à 10 %`
- `budget infrastructure à 25 %`
- `alliance avec [État]`
- `traité commercial avec [État]`
- `déclare la guerre à [État]`
- `paix avec [État]`
- `embargo contre [État]`
- `fin du tour`
- `aide`

Le mode hors ligne reste disponible si aucun fournisseur n'est connecté. Le bouton de réglages ouvre l'assistant existant d'Azgaar ; cette version ne met pas en place de connexion OAuth à un compte ChatGPT.

## Sauvegarde et limites connues

- Les modifications de carte (routes, marchés, taxes, budgets, relations) font partie des données Azgaar : utiliser le bouton **Save** d'Azgaar pour enregistrer le fichier `.map`.
- Les données de campagne (tour, trésors, traités, guerres, projets et chronique) sont enregistrées dans le stockage local du navigateur. Le tableau de bord permet aussi d'exporter puis d'importer une sauvegarde JSON, à utiliser avec le même fichier de carte. La sauvegarde de campagne et le fichier `.map` restent deux fichiers distincts.
- Les conflits sont résolus par un score abstrait : il n'y a pas de combat tactique, de pertes d'unités, de déplacement de fronts, de multijoueur ni de synchronisation en ligne.
- La suite de tests automatisés comprend les tests de coûts, de construction, de tours, de conflits et de sauvegarde ; un test visuel complet dans un vrai navigateur et des scénarios de parties longues restent nécessaires.
