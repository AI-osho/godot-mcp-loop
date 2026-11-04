extends RefCounted
# ===============================================================
# 星剣のルカ - game data (original story, monsters and maps)
# ===============================================================

const TILE_SIZE := 16
const MAP_W := 16
const MAP_H := 15
const SCREEN_W := 256
const SCREEN_H := 240
const MOVE_FRAMES := 8          # 16px / 8 frames = 2px per physics frame
const TYPING_FRAMES_PER_CHAR := 1

const TITLE := "星剣のルカ"
const SUBTITLE := "エルディアの 星を とりもどせ"
const PRESS_START := "PRESS START"

const TILES_PATH := "res://examples/rpg/images/tiles.png"
const HERO_PATH := "res://examples/rpg/images/hero.png"
const NPCS_PATH := "res://examples/rpg/images/npcs.png"
const LOGO_PATH := "res://examples/rpg/images/logo.png"

# char -> { frame, walk, enc (encounter denominator, 0 = none) }
const TILE_DEFS := {
	"g": {"frame": 0, "walk": true, "enc": 10},
	"f": {"frame": 1, "walk": true, "enc": 7},
	"m": {"frame": 2, "walk": false, "enc": 0},
	"w": {"frame": 3, "walk": false, "enc": 0},
	"p": {"frame": 4, "walk": true, "enc": 0},
	".": {"frame": 4, "walk": true, "enc": 0},   # town ground
	"T": {"frame": 5, "walk": true, "enc": 0},   # town gate
	"S": {"frame": 6, "walk": true, "enc": 0},   # star shrine
	"#": {"frame": 7, "walk": false, "enc": 0},  # wall
	",": {"frame": 8, "walk": true, "enc": 0},   # castle floor
	"C": {"frame": 9, "walk": false, "enc": 0},  # castle wall
	"H": {"frame": 10, "walk": false, "enc": 0}, # house
	"D": {"frame": 11, "walk": true, "enc": 0},  # castle door
	"F": {"frame": 12, "walk": false, "enc": 0}, # fountain
	"E": {"frame": 4, "walk": true, "enc": 0},   # town exit
	"e": {"frame": 8, "walk": true, "enc": 0},   # castle exit
}

const MAPS := {
	"world": {
		"rows": [
			"mmmmmmmmmmmmmmmm",
			"mggggffgggmmmggm",
			"mgffgffgggggwwgm",
			"mgffgggmmggggSgm",
			"mggggggmmggggpgm",
			"mggwwgggggwggpgm",
			"mggwwggffgwggpgm",
			"mggggggffggggpgm",
			"mggpgggfgggggpgm",
			"mggpggggmmgggpgm",
			"mggpggTgmmgggpgm",
			"mggpppppppppppgm",
			"mggggffggggggggm",
			"mgggggggffggwwgm",
			"mmmmmmmmmmmmmmmm",
		],
		"name": "エルディア そうげん",
		"warps": {
			"T": {"map": "town", "pos": Vector2i(7, 12)},
		},
	},
	"town": {
		"rows": [
			"################",
			"#.....CCCC.....#",
			"#.....CCCC.....#",
			"#.....CDDC.....#",
			"#..............#",
			"#..HH.......HH.#",
			"#..HH.......HH.#",
			"#..............#",
			"#.....wwww.....#",
			"#.....wwww.....#",
			"#..............#",
			"#..HH......HH..#",
			"#..............#",
			"#......EE......#",
			"################",
		],
		"name": "エルディア の まち",
		"warps": {
			"E": {"map": "world", "pos": Vector2i(6, 11)},
			"D": {"map": "castle", "pos": Vector2i(7, 12)},
		},
	},
	"castle": {
		"rows": [
			"################",
			"#..............#",
			"#..##########..#",
			"#..#,,,,,,,,#..#",
			"#..#,,,,,,,,#..#",
			"#..#,,,,,,,,#..#",
			"#..####..####..#",
			"#,,,,,,,,,,,,,,#",
			"#,,,,,,,,,,,,,,#",
			"#,,,,,,,,,,,,,,#",
			"#,,,,,,,,,,,,,,#",
			"#,,,,,,,,,,,,,,#",
			"#,,,,,,,,,,,,,,#",
			"#,,,,,,ee,,,,,,#",
			"################",
		],
		"name": "エルディア じょう",
		"warps": {
			"e": {"map": "town", "pos": Vector2i(7, 4)},
		},
	},
}

const START_POS := {"map": "castle", "pos": Vector2i(7, 9)}

const NPCS := {
	"world": [],
	"town": [
		{"id": "mina", "name": "ミナ", "sprite": 1, "pos": Vector2i(3, 10), "facing": "down"},
		{"id": "elder", "name": "ノア", "sprite": 2, "pos": Vector2i(12, 10), "facing": "down"},
	],
	"castle": [
		{"id": "king", "name": "オルデン王", "sprite": 0, "pos": Vector2i(7, 4), "facing": "down"},
		{"id": "guard", "name": "ガルド", "sprite": 3, "pos": Vector2i(5, 7), "facing": "right"},
	],
}

# A page = up to 3 lines. "first" is used until the matching flag is set.
const DIALOGUES := {
	"king": {
		"first": [
			["ルカよ、よくきた。", "星の宝珠が 冥王ゾルガに", "うばわれてしまった。"],
			["宝珠が ないと 星剣ルミナは", "光を うしなう。", "くにに 夜が おとずれる…"],
			["北東の 星のほこらへ いき、", "ゾルガを たおしてくれ。", "これが 旅立ちの しるしじゃ。"],
			["50ゴールドと やくそうを", "わたそう。", "ルカよ、気をつけて いけ。"],
		],
		"repeat": [
			["星のほこらは 北東じゃ。", "水や 山に 気をつけてな。"],
		],
	},
	"mina": {
		"first": [
			["ルカ、いってらっしゃい！", "これ、やくそうよ。", "うけとって！"],
			["北東の 星のほこらに", "ゾルガが いるって はなしよ。", "きをつけてね。"],
		],
		"repeat": [
			["ルカ、だいじょうぶ？", "やくそうが あったら", "つかうのよ。"],
		],
	},
	"elder": {
		"first": [
			["むかし、星剣ルミナの光が", "この地を まもっておった…", "いまは 空に 星が ない。"],
			["水や 山は とおれん。", "森や 草むらでは", "モンスターが でるぞ。"],
		],
		"repeat": [
			["星のほこらは 北東じゃ。", "森の 先に 見えるぞ。", "気をつけて いけ。"],
		],
	},
	"guard": {
		"first": [
			["王さまに あってから", "でかけると よい。", "町の 北に お城が ある。"],
			["星のほこらは 北東じゃ。", "森の 先に 見えるぞ。"],
		],
		"repeat": [
			["ルカどの、ごぶじを！", "王さまが しんぱいなさって", "おられたぞ。"],
		],
	},
}

const MONSTERS := {
	"pulun": {
		"name": "プルン", "hp": 12, "atk": 6, "def": 2, "exp": 4, "gold": 3,
		"sprite": "res://examples/rpg/images/monster_pulun.png", "size": 32,
	},
	"tsunousagi": {
		"name": "ツノウサギ", "hp": 16, "atk": 8, "def": 3, "exp": 6, "gold": 5,
		"sprite": "res://examples/rpg/images/monster_tsunousagi.png", "size": 32,
	},
	"morinoko": {
		"name": "モリノコ", "hp": 22, "atk": 9, "def": 4, "exp": 10, "gold": 8,
		"sprite": "res://examples/rpg/images/monster_morinoko.png", "size": 32,
	},
	"hone": {
		"name": "ホネせんし", "hp": 30, "atk": 12, "def": 6, "exp": 18, "gold": 15,
		"sprite": "res://examples/rpg/images/monster_hone.png", "size": 32,
	},
	"zorga": {
		"name": "冥王ゾルガ", "hp": 90, "atk": 18, "def": 7, "exp": 100, "gold": 200,
		"sprite": "res://examples/rpg/images/monster_zorga.png", "size": 48, "boss": true,
	},
}

const ENCOUNTER_POOLS := {
	"near": ["pulun", "pulun", "tsunousagi"],
	"mid": ["tsunousagi", "morinoko", "pulun"],
	"far": ["morinoko", "hone", "hone"],
}

const PLAYER_START := {
	"name": "ルカ", "level": 1,
	"hp": 30, "max_hp": 30,
	"mp": 10, "max_mp": 10,
	"atk": 12, "def": 6,
	"exp": 0, "next_exp": 20,
	"gold": 40, "herbs": 3,
}

const SPELL_LIGHT := {"name": "ヒカリ", "mp": 4}
const SPELL_HEAL := {"name": "イヤシ", "mp": 3}
const HERB_HEAL := 15

const OPENING_LINES := [
	"星が きえた 夜、",
	"エルディアの 空には",
	"あつい やみが ながれた。",
	"",
	"星剣ルミナの 光は",
	"冥王ゾルガの 手に",
	"うばわれてしまった。",
	"",
	"王さまは 若き剣士",
	"ルカを よんだ。",
	"",
	"「ルカよ、",
	"  星を とりもどせ――」",
	"",
	"",
	"北東の 星のほこらへ。",
]

const EPILOGUE_PAGES := [
	["冥王ゾルガは たおれ、", "星の宝珠は エルディアに", "もどった。"],
	["空に 星が かえり、", "星剣ルミナは ふたたび", "光を はなった。"],
	["ルカの 物語は", "ここで ひとつの", "結末を むかえる。"],
]

const CREDITS_LINES := [
	"",
	"",
	"星剣のルカ",
	"",
	"",
	"スタッフ",
	"",
	"ものがたり　　エルディア王国",
	"",
	"せいさく　　　星剣工房",
	"",
	"せんしゅう　　ミナ",
	"",
	"そうだん　　　ノア",
	"",
	"みまもり　　　オルデン王",
	"",
	"とくべつ きょうりょく",
	"",
	"　　星のほこら",
	"",
	"　　そして あなた",
	"",
	"",
	"ありがとう ございました",
	"",
	"",
	"おわり",
]

const CREDITS_NOTE := "PRESS START で タイトルへ"
