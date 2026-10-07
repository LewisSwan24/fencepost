"""The words a short share code is made of (#54).

A short code is three of these joined by hyphens, `wattle-moon-gum`, read off a share tag or
a phone at the fence and typed in by a neighbour. So every word here has to survive being
said out loud and typed by somebody who only heard it:

- plain lowercase letters, three to six of them;
- one spelling only, so nothing with an Australian and an American form (colour, grey);
- no homophones of each other or of a commoner word (no sea/see, tail/tale, flour/flower),
  because a code read aloud is heard, not seen;
- nothing rude, sad or alarming to see on a screen held out to a neighbour, no weapons and
  no brand names;
- nothing easy to misspell from hearing it (gherkin, yacht, bazaar), since a misspelt word
  is a code that does not work.

Just over a thousand words gives over a billion codes, which is what the guessing limits
in app.py are sized against. Curated here rather than downloaded, so there is no licence to
carry and no list to keep in step with somebody else's. tests/test_short_codes.py checks
the rules above that a machine can check.
"""

WORDS = tuple("""
able acorn acre actor adult agate album alder alley almond alpaca alpine amber amulet anchor
angle anise ankle antler anvil apiary apple apricot apron aqua arcade arch arena arrow ash
aspen aster atlas atoll atrium attic autumn avenue avocado award axis bacon badge bagel
bagpipe baker bakery balcony ballad ballet bamboo banana bandana bangle banjo banksia banner
bantam banyan barge bark barley barn barrel basalt basil basin basket bath batik bay beach
beacon bead beagle beak beam beanie beaver beech beetle bench beret bike bilby biplane birch
bird bison bistro blade blanket blaze blazer blend blimp block bloom blossom bluff boat
bobbin bobcat bolt bonfire bongo bonnet bonsai book bookend boot boronia bottle boulder
bounce bowl box boxcar bramble branch brass brave breeze brick bridge brie bright brine
brolga brook broom brownie brush bubble bucket buckle bud budget buffalo buggy bugle bulb
bulldog bundle bungee bunny bunting bunya burger burrito burrow bus bush butter button
cabana cabbage cabin cable cactus caddy cafe cake calico calm camel cameo camera camp camper
canal canary candle candy canoe canopy canvas canyon cape caper capsule caramel caravan card
cargo carob carpet cart carton cascade cashew castle catkin cave cavern cedar celery cello
chair chalet chalk chapel chariot charm cheddar cheese cheetah cherry cherub chess chest
chick chime chimney chip chisel chive chorus chowder cider cinder cinema circle citadel
citrus city clam clay cliff climber clipper clock cloud clover coach coast coaster coat
cobalt cobbler cobweb cocoa coconut coffee coin collar comb comet comic compass conch condor
cook cookie copper coral cork corn cornet cosmos cottage cotton couch cougar cove cowboy
coyote crab cradle craft crane crater crayon crepe cricket crocus croquet crown cruiser
crumb crust crystal cube cuckoo cumin cumulus cup cupcake curtain cushion cycle dahlia daisy
dance dandy dapple dawn dazzle decoy delta denim desk dial diary dimple diner dingo dinner
dipper disco dish dock dolphin domino donkey doodle door dory dot dove dragon drawer dream
dress drift drizzle drover drum duck dugong dune dusk duvet dynamo eagle easel echidna echo
eddy eel eggcup eggnog egret elbow elder elk elm ember emblem emerald emu engine ensign
envoy epic fable fabric fairway falafel falcon fan fanfare farm farmer fawn feast feather
fence fennel fern ferret ferry fiddle field fiesta fig filbert film finch fire firefly flag
flagon flame flannel flask flax fleck fleece fleet flint flock flora floret flurry flute
foam fog folk fondant fondue forage forest fork fort fossil fox frame freckle fresco fridge
frog frolic frost fruit fudge funnel gable gadget galah galaxy galleon gander garden garland
garlic garnet gate gazebo gecko gelato gem geyser giant ginger gingham ginseng giraffe
glacier glade glass glen glider globe glove glow goanna goat goblet goggles gold golf
gondola goose gopher gorilla gorse gosling gourd grain granary granite granola grape graph
grass gravel gravy grid griddle grill grotto grove guava guitar gull gully gum gumboot
gumdrop gusto habit haiku halibut hamlet hammer hammock hamster harp harvest hat haven hazel
heart hearth heath heather hedge helix helmet hemlock herb heron hickory hiker hill hilltop
hive hobby holly honey hoof hook hoop hopper horizon horn hornet hotel huddle hula humming
hurdle husky hut ibis icicle icing igloo iguana index ink inkpot inkwell inlet iris island
ivory ivy jackal jacket jade jam jar jasmine jazz jelly jersey jet jetty jewel jigsaw jingle
jockey jogger jogging journal joust jubilee judge jug juice jumper jungle juniper karate
kayak kazoo kebab keel kelp kennel kestrel kettle key kiosk kipper kitchen kite kitten kiwi
knee koala koi kumquat lace ladder ladle lagoon lake lamb lamp lantern lanyard lapel larder
lark lasso latch latte lattice laurel lava lawn leaf ledge leek lemon lemur lens lentil
letter lever lilac lily lime linden linen linnet lion lizard lobby lobster locket locust
lodge loft logbook lookout loom lotus lullaby lumber lunch lupin lyric macaw magnet magpie
mallard mallee mallow manatee mango mantle maple marble marina market marmot marquee marsh
mascot mask mayfly meadow melody melon menu mermaid mesa meteor midday minaret minnow mint
mirror mistral mitten moat mocha model mohair monkey monsoon moon morsel mosaic moss moth
motor mound mouse muesli muffin mug mulch mural museum music muslin mustard myrtle nacho
nail napkin narwhal nebula nectar needle nest net nettle nickel nimbus nomad noodle north
nougat nugget numbat nutmeg oak oasis oat oatmeal obelisk ocean ocelot octave okra olive
onion opal opossum orange orbit orchard orchid origami osprey ostrich otter outback outpost
oval oven owl oyster paddle paddock pagoda paint paisley palace palm pancake panda pantry
papaya paper paprika papyrus parade parasol parcel parka parrot parsley parsnip pasta pastel
pastry path patio pavlova peach peacock peanut peapod pebble pecan pelican pencil penguin
pennant pepper petunia pewter piano piccolo picket pickle picnic pigeon pigment pillar
pillow pilot pinball pine pipe pirate pitcher pizza planet plaza plinth plover plum plume
pocket poem polenta polka pollen polo pomelo pompom poncho pond pony popcorn poppy porch
possum postbox potato pottery pouch prairie prawn pretzel prism prune pudding puddle puffin
pulley pumice pumpkin puppet puppy quail quest quilt quinoa quiver quokka quoll rabbit
raccoon radar radio radish raft rafter rainbow raisin rake rampart ranch raptor rattle raven
ravioli redwood reef regatta relish ribbon rice ridge risotto river rivulet robin robot
rocker rocket rodeo roller roof room rooster rope rosella rosette rotunda rowan rowboat ruby
rudder rug ruler runway rush saddle safari saffron sage sailor salad salmon salt sandal
sandbar sapling sardine satchel satin saucer sauna scallop scarf school sconce scone scooter
seagull seal season seaweed sedge seed sequin sesame sextant shadow shark shelf shell
sherbet shield shingle ship shovel shrub siesta silk silver singer siren skate sketch ski
skillet skink sky skylark skyline sled slipper sloth snail snapper snorkel snow snowman soap
sock sofa sonnet sorbet sorrel soup soybean spade spaniel spark sparrow spice spider spinach
spindle spinner sponge spoon sprig spring sprout spruce squash squid stable stage stamp star
statue steeple stem stew stirrup stool stork storm stove straw stream street string strudel
studio sugar suit summer summit sunbeam sundial sunrise sunset surfer swallow swan sweater
swing syrup tabby table tablet taco tadpole tandem tango tank tansy tapir tartan teacup teal
teapot teasel tempo tennis tent terrace thicket thimble thistle thread thumb tiara ticket
tiger timber tinder tinsel toast toffee tofu toggle tomato tool topaz topiary topsail torch
totem toucan towel tower toy track tractor trail train tram trawler tray treaty treetop
trellis trinket tripod trivia trophy trout trowel truck truffle trumpet tugboat tulip tuna
tundra tunnel turnip turret turtle tusk tutor tuxedo twig ukulele unicorn upland valley
vanilla vase velvet veranda vessel viaduct vine vinyl violin visor vista volcano voyage
wafer waffle wagon wagtail wallaby walnut walrus wand waratah warbler warren washer wasp
water wattle wax wetland wetsuit wheat wheel whisk whistle wicket willow window winter
wizard wombat woodcut wool wren yabby yak yard yarn yeti yodel zebra zigzag zinc zipper zone
""".split())
