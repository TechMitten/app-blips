// Docs site, opened from the Help key and the "?" shortcut.
export const DOCS_URL = 'https://docs.appblips.com/';

import {
  Wand2, Smartphone, Code2, Layout, 
  TerminalSquare, Timer, CloudSun, Receipt, ListChecks, 
  Edit2, Clock, ListTodo, Wallet, 
  Monitor, 
  Calculator, KeyRound, Ruler, Zap, Layers,
  Search, Rocket, Trophy, Radio, Keyboard, ChefHat,
  GraduationCap, Music, Dumbbell, Gamepad2, Dices, Bomb, Target, Flame, Puzzle, Swords, Ghost,
  Worm, WholeWord, CalendarCheck, PiggyBank, Shapes, Drum, Hammer, CircleDot, CircleDotDashed,
  Atom, Palette, Bug, Gauge, Regex, Database, Braces, Hourglass, Bird, Blocks, Coins,
  Briefcase, Camera, UtensilsCrossed, Store, Newspaper, BookOpen, Heart, Sprout, Package,
  Building2, Plane, Scissors, Stethoscope, Scale, Coffee, Cpu, PawPrint, Landmark, Mic, Film,
  Shirt, Flower2, Car, Wine, Baby, Users, Paintbrush, Waves, Tent,
  Feather, Grid2x2, Grid3x3, Joystick, Footprints, Radar, Moon, Castle, Flag, Goal, Medal,
  Crosshair, Volleyball, Type, Spade, Club, Brain, Crown, Ship, Hash, Route, Sun, Snowflake,
  Biohazard, Shield, Helicopter, Mountain, Map, Eye, Flashlight, Sword, Diamond, Pickaxe,
  Cookie, Tractor, Pizza, Fish, Egg, Orbit, Droplets, MountainSnow, Sailboat, Train, Hexagon,
  Telescope, Globe, Lightbulb, Bike, Hand, Axe, Skull, Cherry, Key, FlaskConical, Bot, Compass,
  Rabbit
} from 'lucide-react';

// The studios share one workspace pipeline (prompt -> code -> versions); the
// mode changes the prompts, starter ideas, default preview device and the
// default project name. Persisted per-project as `studioMode`. `description`
// is the user-facing "what makes this studio different" line -- surfaced in
// the studio switcher tooltips and the mobile menu.
export const STUDIO_MODES = {
  app: {
    key: 'app',
    label: 'App',
    article: 'app',
    untitledName: 'Untitled App',
    defaultPreviewMode: 'mobile',
    description: 'Interactive tools and dashboards — JavaScript-driven, saves your data, feels native on a phone.',
  },
  website: {
    key: 'website',
    label: 'Website',
    article: 'website',
    untitledName: 'Untitled Website',
    defaultPreviewMode: 'desktop',
    description: 'Content-first pages — landing pages, portfolios, blogs — that you edit by clicking them in the preview.',
  },
  game: {
    key: 'game',
    label: 'Game',
    article: 'game',
    untitledName: 'Untitled Game',
    defaultPreviewMode: 'mobile',
    description: 'Playable browser games — canvas and Phaser engines, physics, scores and sound — with touch and keyboard controls.',
  },
  // An imported React + Vite project (src/lib/codebase/): real files and
  // folders instead of generated HTML pages. Only created by importing a .zip.
  codebase: {
    key: 'codebase',
    label: 'Imported site',
    article: 'site',
    untitledName: 'Imported Site',
    defaultPreviewMode: 'desktop',
    description: 'A React + Vite project imported from a .zip — keeps its real files, exports back as a project.',
  },
};

// A saved or interrupted job's studioMode, defaulting unknown values to 'app'.
export const normalizeStudioMode = (mode) => (Object.hasOwn(STUDIO_MODES, mode) ? mode : 'app');

export const HTML_STREAM_START_RE = /```html|<!DOCTYPE html|<html[\s>]/i;

export const PRESET_COLORS = [
  "text-amber-600 bg-amber-50",
  "text-sky-600 bg-sky-50",
  "text-emerald-600 bg-emerald-50",
  "text-indigo-600 bg-indigo-50",
  "text-violet-600 bg-violet-50",
  "text-rose-600 bg-rose-50",
  "text-blue-600 bg-blue-50",
  "text-teal-600 bg-teal-50"
];

export const AVAILABLE_ICONS = {
  Wand2, Smartphone, Code2, Layout, TerminalSquare, Timer, CloudSun, Receipt, ListChecks, Edit2, Clock, ListTodo, Wallet, Calculator, KeyRound, Ruler, Zap, Layers, Search, Monitor, Trophy, Radio, Keyboard, Rocket, Gamepad2, Dices, Bomb, Target, Flame, Puzzle, Swords, Ghost, Worm, WholeWord, CalendarCheck, PiggyBank, Shapes, Drum, Hammer, CircleDot, CircleDotDashed, Atom, Palette, Bug, Gauge, Regex, Database, Braces, Hourglass, Bird, Blocks, Coins
};

export const STARTER_PRESETS = [
  {
    title: "Weather Forecast",
    prompt: "A high-quality weather app built with Material You design and dynamic color palettes. Includes live conditions, 7-day forecast cards, hourly charts, animated weather artwork, and air quality metrics.",
    category: "Weather",
    icon: CloudSun,
    featured: true,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Space Shooter",
    prompt: "A complete, fully functional arcade space shooter with touchscreen virtual controls and keyboard support. Features laser cannons, wave-based alien fleets, shield power-ups, and particle explosion effects.",
    category: "Arcade",
    icon: Rocket,
    featured: true,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Internet Radio",
    prompt: "A free live radio streaming app streaming real online radio stations across Lo-Fi, Jazz, Chillwave, and Classical, with an interactive tuner dial, playback controls, and live audio visualizer.",
    category: "Audio",
    icon: Radio,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Retro Snake",
    prompt: "A classic retro arcade Snake game with smooth grid navigation, growing tail mechanics, collectible golden apples, speed multipliers, particle food bursts, and high-score tracking.",
    category: "Arcade",
    icon: Worm,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Typing Test",
    prompt: "A modern typing test app to improve typing skills with a sleek UI, real-time WPM and accuracy metrics, smooth jumping caret, mistyped heatmaps, sound feedback, and practice drill modes.",
    category: "Typing",
    icon: Keyboard,
    color: "text-teal-600 bg-teal-50"
  },
  {
    title: "Recipe Finder",
    prompt: "A polished recipe discovery app with a searchable, filterable card grid, step-by-step cook mode with a built-in timer, adjustable ingredient serving sizes, and a save-to-favorites collection.",
    category: "Cooking",
    icon: ChefHat,
    featured: true,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "2048 Puzzle",
    prompt: "The addictive 2048 sliding number puzzle with animated tile merging, smooth swipe and keyboard arrow controls, score and best-score displays, undo move button, and victory celebration.",
    category: "Puzzle",
    icon: Dices,
    featured: true,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Focus Timer",
    prompt: "A Pomodoro-style focus timer with a smooth animated countdown ring, customizable work/break intervals, an ambient session soundtrack, daily streak tracking, and a running log of completed sessions.",
    category: "Productivity",
    icon: Timer,
    featured: true,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Minesweeper",
    prompt: "An authentic Minesweeper game featuring beginner, intermediate, and expert grid sizes, flag toggling, chord reveals, live bomb counter, and elapsed time stopwatch.",
    category: "Classic",
    icon: Bomb,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Budget Planner",
    prompt: "A personal budget tracker with quick expense entry, category breakdown charts, a monthly spending vs. income summary, savings goal progress bars, and a clean ledger of recent transactions.",
    category: "Finance",
    icon: PiggyBank,
    color: "text-teal-600 bg-teal-50"
  },
  {
    title: "Flashcard Study",
    prompt: "A spaced-repetition flashcard app with swipeable cards, deck creation and editing, a flip animation, confidence-based review scheduling, and per-deck mastery progress tracking.",
    category: "Education",
    icon: GraduationCap,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Habit Tracker",
    prompt: "A daily habit tracker with a clean weekly grid view, one-tap check-ins, streak counters with milestone celebrations, per-habit color coding, and a monthly completion heatmap.",
    category: "Productivity",
    icon: CalendarCheck,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Pixel Bird",
    prompt: "A retro pixel-style bird flapping obstacle runner with one-tap physics, scrolling parallax pipes, collision detection, coin pickups, medal achievements, and instant restart.",
    category: "Arcade",
    icon: Bird,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Drum Machine",
    prompt: "A playable step-sequencer drum machine with multiple synthesized drum kits, an adjustable BPM, a 16-step pattern grid, pattern save/load slots, and reactive visual pulses on each beat.",
    category: "Audio",
    icon: Drum,
    featured: true,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Memory Match",
    prompt: "A colorful card matching memory game with 3D flip card animations, emoji pair themes, move counter, accuracy score, combo streak multipliers, and star rating on completion.",
    category: "Memory",
    icon: Shapes,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Workout Log",
    prompt: "A gym workout logger with exercise search, per-set weight and rep tracking, automatic rest timers between sets, a personal-record tracker, and progress charts across past sessions.",
    category: "Fitness",
    icon: Dumbbell,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Unit Converter",
    prompt: "An elegant unit converter covering length, weight, temperature, volume, and currency with live two-way conversion as you type, a recent-conversions history, and quick-swap unit buttons.",
    category: "Utility",
    icon: Ruler,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Connect Four",
    prompt: "A modern Connect Four board game with gravity piece-drop physics, unbeatable Minimax AI mode or local pass-and-play, winning 4-in-a-row highlight animations, and round win stats.",
    category: "Strategy",
    icon: Coins,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Piano Keyboard",
    prompt: "A playable multi-octave piano with velocity-sensitive keys, touch and computer-keyboard support, a selection of instrument voices (grand piano, synth, organ), a sustain toggle, and a record-and-playback loop feature.",
    category: "Music",
    icon: Music,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Trivia Quiz",
    prompt: "An animated trivia quiz game with multiple categories and difficulty levels, a 15-second question timer, streak bonuses, lifelines, an explanations panel after each answer, and a final score card with shareable results.",
    category: "Quiz",
    icon: Trophy,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Markdown Notes",
    prompt: "A lightweight note-taking app with a live split-pane Markdown editor and preview, nested folders and tags, full-text search, pinned notes, and automatic local saving with an export-to-file option.",
    category: "Notes",
    icon: Edit2,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Expense Splitter",
    prompt: "A group expense splitter that tracks who paid for what, supports equal and custom splits, shows each person's net balance, suggests the fewest settling-up payments, and keeps a running history per trip or household.",
    category: "Finance",
    icon: Wallet,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Event Countdown",
    prompt: "A polished countdown app with large animated day/hour/minute/second digits for multiple saved events, custom colors and emoji per event, a progress bar for elapsed time, and milestone markers as the date approaches.",
    category: "Utility",
    icon: Clock,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Dice Roller",
    prompt: "A tabletop dice roller supporting standard polyhedral dice (d4 through d20), roll modifiers, advantage and disadvantage modes, saved roll presets, an animated roll, and a scrollable history with running totals.",
    category: "Tabletop",
    icon: Dices,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Sleep Sounds",
    prompt: "An ambient sound mixer with looping rain, thunder, waves, wind, and fireplace tracks, independent volume sliders per layer, a sleep timer with fade-out, and saveable soundscape presets.",
    category: "Audio",
    icon: Waves,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Password Generator",
    prompt: "A secure password generator with adjustable length, character-set toggles, a passphrase mode, a live strength meter, one-click copy, and a locally stored history of recently generated passwords.",
    category: "Security",
    icon: KeyRound,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "HIIT Interval Timer",
    prompt: "A high-intensity interval training timer with configurable work and rest rounds, a preparation countdown, a large color-coded phase display, audio beeps, and a session summary of completed rounds.",
    category: "Fitness",
    icon: Flame,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Periodic Table",
    prompt: "An interactive periodic table with color-coded element groups, click-to-expand element details such as atomic mass, category, and electron configuration, plus search, property filters, and an element-symbol quiz mode.",
    category: "Science",
    icon: Atom,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Color Palette Studio",
    prompt: "A color palette generator that builds harmonious schemes from a base color, shows HEX, RGB, and HSL values with copy buttons, previews palettes on UI mockups, saves favorites, and exports as CSS variables.",
    category: "Design",
    icon: Palette,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Kanban Board",
    prompt: "A drag-and-drop kanban task board with customizable columns and cards, labels and due dates, card counts per column, a quick-add bar, and persistent local storage across reloads.",
    category: "Productivity",
    icon: ListTodo,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Water Tracker",
    prompt: "A hydration tracker with an animated filling bottle visual, one-tap glass and bottle quick-add buttons, a daily goal ring, streak tracking, and a weekly intake chart.",
    category: "Health",
    icon: Heart,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Word Grid",
    prompt: "A Wordle-style word guessing game with six attempts, color-coded letter feedback, an on-screen keyboard that tracks used letters, daily-puzzle and unlimited modes, and a stats panel with guess distribution.",
    category: "Word",
    icon: WholeWord,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Sliding Puzzle",
    prompt: "A sliding tile puzzle game with shuffled 3x3, 4x4, and 5x5 boards, numbered and photo modes, smooth tile animations, move and time counters, and a solvability check on shuffle.",
    category: "Puzzle",
    icon: Puzzle,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Tic-Tac-Toe AI",
    prompt: "A sleek tic-tac-toe game with an unbeatable minimax AI plus easy and medium difficulties, a local two-player mode, win-line animations, and a running scoreboard across rounds.",
    category: "Strategy",
    icon: Gamepad2,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Sudoku",
    prompt: "A full-featured Sudoku app with multiple difficulty levels, a note-taking mode, hints and mistake checking, a timer, undo, and auto-generated puzzles with a unique-solution guarantee.",
    category: "Puzzle",
    icon: Blocks,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Scientific Calculator",
    prompt: "A scientific calculator with a full expression display, trig, log, powers and roots, memory keys, a degree/radian toggle, a calculation history tape, and keyboard input support.",
    category: "Utility",
    icon: Calculator,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Invoice Maker",
    prompt: "A freelance invoice builder with line items, automatic totals and tax, client and business details, a live printable preview, invoice numbering, and saved invoice history with status tracking.",
    category: "Business",
    icon: Receipt,
    color: "text-teal-600 bg-teal-50"
  }
];

// Game-studio starters. These are gameplay-first: each one names the loop, the
// controls and the win/lose condition so the build starts from something
// actually playable rather than a static mockup. Kept separate from the app
// pool, which still carries its own arcade ideas.
export const GAME_STARTER_PRESETS = [
  {
    title: "Neon Breakout",
    prompt: "A neon arcade breakout game on a canvas with a smooth paddle, multi-hit bricks, falling power-ups (wide paddle, multi-ball, laser), particle shatter effects, three lives, and a persistent high-score table.",
    category: "Arcade",
    icon: Gamepad2,
    featured: true,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Tower Defense",
    prompt: "A grid-based tower defense game where enemies march along a path toward a base, the player places and upgrades several tower types with their own projectiles and effects, waves escalate in difficulty, and gold and lives determine win or loss.",
    category: "Strategy",
    icon: Target,
    featured: true,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Platform Runner",
    prompt: "A side-scrolling platformer with a responsive jump arc, coyote time, moving platforms, collectible coins, stompable enemies, checkpoint flags, and multiple levels loaded from a simple tile map with parallax backgrounds.",
    category: "Platformer",
    icon: Rocket,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Asteroid Field",
    prompt: "A twin-stick space shooter where the ship thrusts and rotates with keyboard or touch, asteroids split when shot, enemy saucers hunt the player, screen wrap, and a wave counter drives the difficulty up.",
    category: "Shooter",
    icon: Bomb,
    featured: true,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Endless Runner",
    prompt: "A one-tap endless runner with auto-scrolling lanes, jump and slide over obstacles, collectible coins, speed that ramps over distance, a score based on meters plus pickups, and an instant restart on death.",
    category: "Arcade",
    icon: Bird,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Dungeon Crawler",
    prompt: "A small roguelike dungeon crawler with procedurally generated rooms, grid or smooth movement, melee and ranged attacks, enemies with simple AI, loot and health pickups, and a floor-by-floor difficulty curve.",
    category: "Roguelike",
    icon: Swords,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Physics Stacker",
    prompt: "A physics tower-builder where the player drops blocks that topple realistically, a swinging crane adds challenge, height is scored, and a Matter.js simulation handles collisions and stability.",
    category: "Physics",
    icon: Blocks,
    color: "text-teal-600 bg-teal-50"
  },
  {
    title: "Match-3 Puzzle",
    prompt: "A juicy match-3 board with swipe-or-click swapping, cascading matches, special gems for four- and five-in-a-row, a move or time limit, and a score target per level.",
    category: "Puzzle",
    icon: Shapes,
    color: "text-fuchsia-600 bg-fuchsia-50"
  },
  {
    title: "Space Invaders",
    prompt: "A retro wave-based shooter where rows of aliens march and descend, the player's turret fires upward, enemy bombs fall, a destructible bunker line provides cover, and waves speed up as they shrink.",
    category: "Retro",
    icon: Ghost,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Sokoban Puzzle",
    prompt: "A block-pushing Sokoban puzzler with hand-designed levels, undo and restart, move and push counters, a level select grid, and a win state when every crate sits on a target.",
    category: "Puzzle",
    icon: Puzzle,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Racing Time Trial",
    prompt: "A top-down or pseudo-3D racing time trial where the car steers with keyboard or touch, the track has drifting physics and checkpoints, lap times are recorded, and a ghost of the best run is replayed.",
    category: "Racing",
    icon: Gauge,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Tower Stacker",
    prompt: "A precision stacking game where a moving block must be dropped to line up with the tower below, overlapping edges are sliced off, the tower speeds up, and the height sets the score.",
    category: "Arcade",
    icon: Coins,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Whack-a-Mole",
    prompt: "A fast reaction game with moles popping from a grid of holes, tap or click to hit them, bombs that cost a life, a combo multiplier, a 60-second timer, and a local high-score board.",
    category: "Casual",
    icon: Flame,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Zeppelin Duel",
    prompt: "A local two-player airship duel on a single shared screen: player one uses WASD and F, player two uses arrows and Enter, each aims and fires cannons with gravity arcs over destructible terrain, and wind shifts each turn.",
    category: "Party",
    icon: Gamepad2,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Snake Arena",
    prompt: "A modern snake game on a grid with smooth interpolated movement, food that grows the snake, golden bonus fruit that expires, walls that appear as the score climbs, swipe or arrow-key controls, and a best-length record.",
    category: "Arcade",
    icon: Worm,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Flappy Glide",
    prompt: "A one-button flappy-style game where a little bird flaps through scrolling pipe gaps, gravity pulls it down, the gaps narrow over time, every pipe passed scores a point, and a medal screen shows bronze to platinum.",
    category: "Arcade",
    icon: Feather,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Falling Blocks",
    prompt: "A falling-block puzzle with the seven classic tetromino shapes, rotation with wall kicks, a ghost piece, hold and next-piece previews, hard and soft drop, line clears that speed up the level, and touch swipe controls.",
    category: "Puzzle",
    icon: Layers,
    featured: true,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "2048 Merge",
    prompt: "A 2048 sliding-tile game on a 4x4 board with swipe and arrow controls, animated slides and merges, a score and best score, an undo button with limited uses, and a keep-going option after reaching 2048.",
    category: "Puzzle",
    icon: Grid2x2,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Minesweeper",
    prompt: "A classic minesweeper with beginner, intermediate and expert boards, a safe first click, flood-fill reveals, right-click or long-press flagging, chording on numbers, a timer and mine counter, and best times per difficulty.",
    category: "Puzzle",
    icon: Bomb,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Pinball Table",
    prompt: "A single-table pinball game with left and right flippers on keys or screen halves, a plunger launch, bumpers and slingshots that kick the ball, lit targets that unlock multiball, a ball-save timer, and three balls per game.",
    category: "Arcade",
    icon: CircleDot,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Pong Rally",
    prompt: "A neon pong game with a one-player mode against a beatable AI and a two-player mode on one keyboard, ball speed that rises with each rally, spin from paddle movement, and first to eleven wins.",
    category: "Retro",
    icon: Joystick,
    color: "text-teal-600 bg-teal-50"
  },
  {
    title: "Maze Chase",
    prompt: "A maze-chase game where the player eats pellets while four ghosts with different chase personalities hunt them, power pellets turn the ghosts vulnerable, fruit bonuses appear, and the level clears when every pellet is gone.",
    category: "Retro",
    icon: Ghost,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Road Crossing",
    prompt: "A lane-hopping crossing game where the player hops forward, back and sideways across busy roads and rivers, rides floating logs, avoids cars and trucks of varying speeds, and reaches safe homes before a timer runs out.",
    category: "Arcade",
    icon: Footprints,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Missile Defense",
    prompt: "A missile-defense game where incoming warheads streak toward six cities, the player clicks or taps to fire interceptors that explode in expanding blasts, three bases have limited ammo, and surviving cities earn bonus points each wave.",
    category: "Retro",
    icon: Radar,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Lunar Lander",
    prompt: "A lunar lander game where the player rotates and fires a thruster against gravity, fuel is limited, the terrain is randomly generated with landing pads of different score multipliers, and landing too fast or tilted crashes the ship.",
    category: "Physics",
    icon: Moon,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Slingshot Siege",
    prompt: "A slingshot physics game where the player drags back to aim and launch projectiles at wooden and stone towers hiding enemies, structures collapse realistically, a limited number of shots per level earn one to three stars.",
    category: "Physics",
    icon: Castle,
    featured: true,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Mini Golf",
    prompt: "A top-down mini golf game with nine holes, drag-to-aim power shots, bouncing walls, slopes, water hazards, moving windmills, a stroke counter against par for each hole, and a scorecard at the end.",
    category: "Sports",
    icon: Flag,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Penalty Shootout",
    prompt: "A football penalty shootout where the player swipes or clicks to aim and curve shots past a reacting goalkeeper, then dives as the keeper to save the opponent's shots, best of five with sudden death.",
    category: "Sports",
    icon: Goal,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Hoop Shots",
    prompt: "A basketball shooting game where the player flicks or drags to throw the ball in an arc at a hoop that moves sideways at higher levels, swishes score extra, a 60-second clock runs, and streaks light the ball on fire.",
    category: "Sports",
    icon: Trophy,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Bowling Alley",
    prompt: "A ten-pin bowling game with aim, power and spin set by a swipe or a timed meter, physics-driven pin collisions, correct strike and spare scoring across ten frames, and a full scorecard.",
    category: "Sports",
    icon: Medal,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Archery Range",
    prompt: "An archery game where the player draws and releases the bow, arrows follow gravity arcs, wind shifts each shot and is shown by a flag, targets move at higher rounds, and ring accuracy decides the score.",
    category: "Sports",
    icon: Crosshair,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Blob Volley",
    prompt: "A two-blob volleyball game where each side jumps and nudges a bouncy ball over the net, play solo against an AI or two players on one keyboard, the ball can't touch your floor, and first to fifteen wins.",
    category: "Sports",
    icon: Volleyball,
    color: "text-teal-600 bg-teal-50"
  },
  {
    title: "Rhythm Tapper",
    prompt: "A four-lane rhythm game where notes scroll toward a hit line in time with a generated Web Audio beat, the player taps lanes or presses D F J K, timing is graded perfect, good or miss, and combos build a multiplier.",
    category: "Rhythm",
    icon: Music,
    featured: true,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Typing Defense",
    prompt: "A typing defense game where words drift toward the player's base, typing a word locks on and destroys it, longer words appear as waves rise, typos break the combo, and words per minute and accuracy show at the end.",
    category: "Typing",
    icon: Keyboard,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Word Guess",
    prompt: "A five-letter word guessing game with six tries, green, yellow and grey letter feedback, an on-screen keyboard that colours used letters, a daily puzzle plus unlimited practice, and win streak statistics.",
    category: "Word",
    icon: WholeWord,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Word Search",
    prompt: "A word search game with themed word lists hidden across a letter grid in all eight directions, drag or tap to select words, found words highlight in unique colours, and a timer with a hint button that reveals a first letter.",
    category: "Word",
    icon: Search,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Hangman",
    prompt: "A hangman word game with categories, an on-screen alphabet, a drawing that builds with each wrong guess, a hint that costs points, and a running score across rounds.",
    category: "Word",
    icon: Type,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Klondike Solitaire",
    prompt: "A Klondike solitaire game with drag-and-drop or tap-to-move cards, draw one or draw three, auto-move to foundations on double-click, unlimited undo, a move counter and timer, and a celebration when all cards are home.",
    category: "Cards",
    icon: Spade,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Blackjack Table",
    prompt: "A blackjack game against a dealer who stands on seventeen, with hit, stand, double down and split, a chip bankroll and betting, a shuffled six-deck shoe, and payouts of 3:2 for blackjack.",
    category: "Cards",
    icon: Club,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Memory Match",
    prompt: "A memory card-flip game with emoji pairs on a grid that grows each level, flip two cards at a time, matched pairs stay revealed, a move counter and timer, and stars awarded for efficient solves.",
    category: "Cards",
    icon: Brain,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Chess vs Computer",
    prompt: "A chess game against a computer opponent with three difficulty levels using minimax search, full legal move rules including castling, en passant and promotion, highlighted legal moves, captured pieces, and check and checkmate detection.",
    category: "Board",
    icon: Crown,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Connect Four",
    prompt: "A connect four game where coloured discs drop and bounce into a seven-by-six grid, play against a smart AI or a second player, the winning line glows, and a score tally carries across rounds.",
    category: "Board",
    icon: CircleDotDashed,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Battleship",
    prompt: "A battleship game where the player places a fleet on a grid, then takes turns firing at the computer's hidden grid, hits and misses are marked with splash and fire effects, sunk ships are announced, and the AI hunts after a hit.",
    category: "Board",
    icon: Ship,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Reversi",
    prompt: "A reversi game on an eight-by-eight board where placing a disc flips every enclosed opponent disc, legal moves are hinted, an AI opponent favours corners, turns are skipped when no move exists, and the disc count decides the winner.",
    category: "Board",
    icon: Grid3x3,
    color: "text-teal-600 bg-teal-50"
  },
  {
    title: "Sudoku",
    prompt: "A sudoku game with generated puzzles at four difficulties, pencil-mark notes, highlighting of matching numbers and conflicts, a hint button, unlimited undo, and a timer with best times.",
    category: "Puzzle",
    icon: Hash,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Picture Logic",
    prompt: "A nonogram picture-logic puzzle where row and column clues reveal a hidden pixel image, click or tap to fill and mark cells, completed clues grey out, and the finished picture is shown in colour.",
    category: "Puzzle",
    icon: Paintbrush,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Pipe Connect",
    prompt: "A pipe-connection puzzle where the player rotates tiles on a grid to route water from a source to every outlet before the flow starts, leaks end the level, and later levels add crossings and longer paths.",
    category: "Puzzle",
    icon: Route,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Laser Mirrors",
    prompt: "A light-beam puzzle where the player places and rotates mirrors and splitters on a grid to bounce a laser into every target, coloured filters must match coloured targets, and each level has a par number of pieces.",
    category: "Puzzle",
    icon: Sun,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Ice Slide",
    prompt: "An ice-sliding puzzle where the character slides until hitting a wall or rock, the goal is to reach the exit in as few moves as possible, cracked ice breaks after one pass, and levels grow from tutorial to fiendish.",
    category: "Puzzle",
    icon: Snowflake,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Bullet Hell",
    prompt: "A vertical bullet-hell shooter with a tiny hitbox ship, dense enemy bullet patterns in spirals and fans, a focus mode that slows movement, collectible power-ups, screen-clearing bombs, and a boss at the end of each stage.",
    category: "Shooter",
    icon: Zap,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Zombie Survival",
    prompt: "A top-down zombie survival shooter where the player moves with WASD or a virtual stick and aims with the mouse or a second stick, zombie hordes grow each night, ammo and weapons are scavenged, and barricades buy time.",
    category: "Survival",
    icon: Biohazard,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Tank Battle",
    prompt: "A top-down tank battle in a destructible brick maze where the player's tank rotates and fires shells that ricochet once, enemy tanks patrol and hunt, the home base must be protected, and power-ups upgrade armour and fire rate.",
    category: "Shooter",
    icon: Shield,
    color: "text-teal-600 bg-teal-50"
  },
  {
    title: "Cave Copter",
    prompt: "A one-button helicopter game where holding lifts and releasing falls, the cave ceiling and floor narrow and wiggle as distance grows, floating blocks block the way, and the best distance is saved.",
    category: "Arcade",
    icon: Helicopter,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Grapple Swing",
    prompt: "A grappling-hook swinging game where tapping fires a rope at the nearest anchor and the player swings with pendulum physics, releasing at the right moment flings them forward over pits, and momentum carries between swings.",
    category: "Platformer",
    icon: Mountain,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Cavern Explorer",
    prompt: "A small metroidvania where the player explores an interconnected cave map, finds abilities like double jump and dash that open new areas, fights enemies and a boss, and a mini-map fills in as rooms are discovered.",
    category: "Adventure",
    icon: Map,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Stealth Heist",
    prompt: "A top-down stealth game where the player sneaks past guards with visible vision cones, hides in shadows, distracts guards with thrown coins, grabs the loot and reaches the exit, and being spotted raises an alarm timer.",
    category: "Stealth",
    icon: Eye,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Dark Manor",
    prompt: "A spooky flashlight exploration game in a pitch-dark manor where only the flashlight cone is visible, batteries drain, keys open locked rooms, a lurking creature follows sounds, and the goal is to find the exit alive.",
    category: "Horror",
    icon: Flashlight,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Street Brawler",
    prompt: "A side-scrolling beat 'em up where the player walks right through stages, punches, kicks and grabs waves of thugs, chains combos, picks up weapons and health, and fights a boss at the end of each street.",
    category: "Fighting",
    icon: Sword,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Deckbuilder Duel",
    prompt: "A turn-based deckbuilding card battler where the player draws five cards, spends energy on attacks, blocks and buffs, enemies show their next intent, defeated enemies offer a choice of new cards, and a branching map leads to a boss.",
    category: "Card Battler",
    icon: Diamond,
    featured: true,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Dice Dungeon",
    prompt: "A dice-rolling roguelike where each turn the player rolls a handful of dice and assigns them to attack, defend and heal slots, enemies grow tougher each floor, and victories unlock new dice faces.",
    category: "Roguelike",
    icon: Dices,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Idle Miner",
    prompt: "An idle mining game where the player taps to dig for ore, hires miners that dig automatically, upgrades pickaxes and carts, descends to deeper layers with rarer gems, and earns offline income while away.",
    category: "Idle",
    icon: Pickaxe,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Cookie Empire",
    prompt: "An incremental clicker game where clicking a giant cookie bakes cookies, cookies buy cursors, grannies, farms and factories that bake automatically, upgrades multiply output, numbers grow to huge abbreviations, and progress is saved.",
    category: "Idle",
    icon: Cookie,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Farm Seasons",
    prompt: "A cozy farming game where the player tills soil, plants seeds, waters crops through day cycles, harvests and sells produce, buys new seeds and animals, and seasons change which crops can grow.",
    category: "Simulation",
    icon: Tractor,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Pizza Rush",
    prompt: "A time-management cooking game where customers order pizzas with specific toppings, the player drags dough, sauce and toppings, bakes in an oven that can burn, serves before patience meters run out, and tips buy kitchen upgrades.",
    category: "Simulation",
    icon: Pizza,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Fishing Pond",
    prompt: "A relaxing fishing game where the player casts a line with a power meter, waits for a bite, plays a reel-tension minigame to land the catch, fills a collection log of fish species and rarities, and buys better rods.",
    category: "Casual",
    icon: Fish,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Pet Hatchery",
    prompt: "A virtual pet game where an egg hatches into a creature with hunger, happiness and energy meters that drain over real time, the player feeds, plays and puts it to sleep, and well-cared-for pets evolve into new forms.",
    category: "Simulation",
    icon: Egg,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Tiny City",
    prompt: "A small city builder on a tile grid where the player zones houses, shops and factories, lays roads and power, balances a budget from taxes, and population grows when residents have jobs and services.",
    category: "Simulation",
    icon: Building2,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Ant Colony",
    prompt: "An ant colony simulation where ants leave pheromone trails to food, the player places food and obstacles, digs tunnels, spends food to hatch worker and soldier ants, and defends the nest from invading beetles.",
    category: "Simulation",
    icon: Bug,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Orbit Slingshot",
    prompt: "A gravity puzzle where the player launches a probe that curves around planets with real orbital pull, the goal is to reach a target portal, black holes and moving moons complicate the path, and fewer attempts earn more stars.",
    category: "Physics",
    icon: Orbit,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Bridge Builder",
    prompt: "A bridge-building physics puzzle where the player connects beams and cables between anchor points within a budget, then runs a test where a truck crosses, joints show stress colours, and overloaded beams snap.",
    category: "Physics",
    icon: Hammer,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Falling Sand",
    prompt: "A falling-sand sandbox where the player paints sand, water, oil, fire, plant, stone and lava onto a pixel grid, elements interact (fire burns oil, water cools lava into stone, plants grow in water), and a brush size slider sets the paint size.",
    category: "Sandbox",
    icon: Droplets,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Snowboard Descent",
    prompt: "A downhill snowboarding game on procedurally generated slopes where the player carves left and right, jumps off ramps and spins for trick points, avoids trees and rocks, and an avalanche chases from behind.",
    category: "Sports",
    icon: MountainSnow,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Sailing Regatta",
    prompt: "A top-down sailing race where wind direction changes and the boat's speed depends on its angle to the wind, the player tacks around buoys on a course, races AI boats, and records the fastest finish time.",
    category: "Racing",
    icon: Sailboat,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Rail Switch",
    prompt: "A train-routing puzzle where coloured trains leave stations on a track network and the player taps switches to send each train to its matching coloured station, more trains arrive faster, and collisions end the run.",
    category: "Puzzle",
    icon: Train,
    color: "text-teal-600 bg-teal-50"
  },
  {
    title: "Hex Tactics",
    prompt: "A turn-based tactics game on a hex grid where the player commands knights, archers and mages with movement ranges and attack types, terrain gives cover and height bonuses, and the AI army must be defeated across several missions.",
    category: "Strategy",
    icon: Hexagon,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Space Trader",
    prompt: "A space trading game where the player flies between star systems on a map, buys and sells goods whose prices vary by planet and random events, upgrades cargo holds and engines, fends off pirates, and aims to retire rich.",
    category: "Strategy",
    icon: Telescope,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Castle Siege",
    prompt: "A real-time strategy game where two castles face each other across a field, the player spends gold that trickles in to send swordsmen, archers and catapults down three lanes, and the first castle to fall loses.",
    category: "Strategy",
    icon: Crown,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Geography Guess",
    prompt: "A geography quiz where a country outline or flag appears and the player picks its name from four choices or clicks its location on a world map, rounds are timed, continents can be filtered, and streaks earn bonus points.",
    category: "Trivia",
    icon: Globe,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Trivia Showdown",
    prompt: "A game-show trivia game with categories like science, history and pop culture, multiple-choice questions on a countdown timer, lifelines like fifty-fifty and skip, climbing prize levels, and a final score screen.",
    category: "Trivia",
    icon: Lightbulb,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Math Blaster",
    prompt: "A math arcade game where falling asteroids carry equations and the player types or taps the correct answer to blast them, difficulty moves from addition up to multiplication and division, and accuracy feeds a rank.",
    category: "Educational",
    icon: Calculator,
    color: "text-teal-600 bg-teal-50"
  },
  {
    title: "Quick Draw Duel",
    prompt: "A two-player reaction duel on one screen or keyboard where both cowboys wait for the signal, the first to press their key after the 'Draw!' wins the round, pressing early is a foul, and best of five takes the match.",
    category: "Party",
    icon: Timer,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Light Cycles",
    prompt: "A light-cycle arena where bikes leave solid neon trails, the player turns at right angles to trap opponents, crashing into any trail is out, play against up to three AI riders or a friend on the same keyboard, and the last rider wins.",
    category: "Party",
    icon: Bike,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Air Hockey",
    prompt: "An air hockey game where each player drags a mallet in their half to hit a sliding puck with realistic bounces off the rails, play against an AI or a friend on a shared touch screen, and first to seven goals wins.",
    category: "Party",
    icon: Hand,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Island Survival",
    prompt: "A survival crafting game on a small island where the player chops trees, mines rocks and gathers berries, crafts tools, a campfire and a shelter, manages hunger and warmth through day and night, and builds a raft to escape.",
    category: "Survival",
    icon: Axe,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Boss Rush",
    prompt: "A top-down action boss rush where the player dodge-rolls through telegraphed attacks and fights a series of bosses each with distinct phases and patterns, health carries between fights, and the clear time is ranked.",
    category: "Action",
    icon: Skull,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Bubble Shooter",
    prompt: "A bubble shooter where the player aims a launcher with a guide line, bounces bubbles off the walls, groups of three or more of the same colour pop, unsupported clusters fall for bonus points, and the ceiling drops every few shots.",
    category: "Arcade",
    icon: CircleDotDashed,
    color: "text-fuchsia-600 bg-fuchsia-50"
  },
  {
    title: "Fruit Slicer",
    prompt: "A fruit-slicing game where fruit is tossed up from below and the player swipes to slice it with a glowing blade trail, slicing several in one swipe earns combos, bombs end the game, and missed fruit cost a life.",
    category: "Arcade",
    icon: Cherry,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Critter Rescue",
    prompt: "A Lemmings-style puzzle where a line of little critters walks forward blindly, the player assigns them limited skills like dig, block, build stairs and float to guide enough of them past hazards to the exit.",
    category: "Puzzle",
    icon: Users,
    color: "text-teal-600 bg-teal-50"
  },
  {
    title: "Bunny Hop",
    prompt: "A vertical jumping game where a bunny auto-bounces on platforms and the player tilts or steers left and right to climb, springs launch higher, some platforms crumble or move, the screen wraps sideways, and the height is the score.",
    category: "Arcade",
    icon: Rabbit,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Escape Room",
    prompt: "A point-and-click escape room where the player inspects objects around a locked room, collects and combines inventory items, solves code locks, sliding puzzles and hidden clues, and escapes before the timer runs out.",
    category: "Puzzle",
    icon: Key,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Potion Brewing",
    prompt: "A potion-brewing puzzle where customers request potions with specific effects, the player mixes ingredients with hidden properties in a cauldron, discovers recipes through experiments recorded in a recipe book, and earns gold for correct brews.",
    category: "Puzzle",
    icon: FlaskConical,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Wizard Duel",
    prompt: "A spell-drawing duel where the player traces shapes with the mouse or finger (a circle for a shield, a zigzag for lightning, a triangle for fire) to cast spells, while the enemy wizard casts back, and health and mana decide the winner.",
    category: "Action",
    icon: Wand2,
    color: "text-fuchsia-600 bg-fuchsia-50"
  },
  {
    title: "Robot Coder",
    prompt: "A programming puzzle where the player arranges command blocks (move, turn, jump, light, loop) into a program that guides a robot across a grid to light every target tile, with a limited number of command slots per level.",
    category: "Logic",
    icon: Bot,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Mahjong Tiles",
    prompt: "A mahjong solitaire game with tiles stacked in a layered turtle layout, only free tiles can be matched, matching pairs clear them, a shuffle and hint button help when stuck, and the board is guaranteed to be solvable.",
    category: "Tiles",
    icon: Layers,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Pirate Treasure",
    prompt: "A top-down pirate adventure where the player sails between islands, follows torn map fragments to dig for treasure, fires cannons broadside at enemy ships, upgrades the ship in ports, and finds the legendary hoard.",
    category: "Adventure",
    icon: Compass,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Deep Sea Diver",
    prompt: "An underwater exploration game where the diver swims ever deeper with limited oxygen, collects treasure and rare fish photos, avoids jellyfish and sharks, darkness grows with depth, and gear upgrades extend each dive.",
    category: "Exploration",
    icon: Waves,
    color: "text-blue-600 bg-blue-50"
  }
];

// How many ideas each studio samples from its pool on every launch. Ask mode
// has no sample size (it shows a fixed set). App's larger pool is sampled the
// same way websites and games already are, so the empty state rotates between
// visits.
export const STARTER_SAMPLE_SIZE = {
  app: 6,
  website: 4,
  game: 4
};

export const WEBSITE_STARTER_PRESETS = [
  {
    title: "Portfolio",
    prompt: "A striking personal portfolio website for a product designer with a bold hero, selected-projects grid with hover reveals, an about section with stats, client logos, testimonials, and a contact section with a working inline form.",
    category: "Portfolio",
    icon: Briefcase,
    featured: true,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "SaaS Landing",
    prompt: "A high-converting SaaS landing page with a navbar, gradient hero with product screenshot mockup, three-tier pricing cards with a monthly/yearly toggle, feature grid with icons, FAQ accordion, and a footer with links and social icons.",
    category: "Marketing",
    icon: Rocket,
    featured: true,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Restaurant",
    prompt: "A warm, appetizing restaurant website with an elegant hero over a full-bleed food photo, story section, tabbed menu with dish photos and prices, chef highlight, reservation form with inline confirmation, opening hours, and location map embed.",
    category: "Food",
    icon: UtensilsCrossed,
    featured: true,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Photography",
    prompt: "A minimalist photography portfolio with a full-screen image hero, masonry gallery grid with lightbox on click, category filters (portraits, landscape, street), an about-the-photographer section, and a booking inquiry form.",
    category: "Gallery",
    icon: Camera,
    color: "text-slate-600 bg-slate-100"
  },
  {
    title: "Local Business",
    prompt: "A friendly local business website for a bike repair shop with services-and-prices cards, photo gallery of the workshop, team member bios, Google-style reviews carousel, hours and location section, and a click-to-call / email contact bar.",
    category: "Business",
    icon: Store,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Product Page",
    prompt: "A polished single-product page with an image gallery, color and size selectors with live price updates, quantity stepper, add-to-cart button with inline confirmation, features list, specs table, reviews with star ratings, and related products row.",
    category: "E-commerce",
    icon: Package,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Blog / Magazine",
    prompt: "An editorial magazine website with a masthead and nav, featured story hero, three-column article grid with category tags and read times, popular sidebar, newsletter signup with inline success message, and a footer archive by month.",
    category: "Publishing",
    icon: Newspaper,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Docs & Help",
    prompt: "A clean documentation site with a sticky sidebar navigation, searchable quickstart guide, code-block styling with copy buttons, version badge, left-column table of contents, and a was-this-helpful feedback widget.",
    category: "Docs",
    icon: BookOpen,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Wedding / Event",
    prompt: "A romantic wedding website with an elegant serif hero with the couple's names and date, our-story timeline, photo gallery, event details with venue cards and maps, RSVP form with meal choices, and a gift registry section.",
    category: "Events",
    icon: Heart,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Nonprofit",
    prompt: "A hopeful nonprofit website with a full-bleed impact hero, mission and stats counters, programs grid with photos, donation tiers card section with a custom amount option, volunteer signup form, and partners logo row.",
    category: "Nonprofit",
    icon: Sprout,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Music Artist",
    prompt: "A moody music artist website with an album-art hero, latest-release player card with a working audio-free tracklist, tour dates list with ticket buttons, photo gallery, newsletter signup, and streaming-platform link buttons.",
    category: "Music",
    icon: Music,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Fitness Coach",
    prompt: "An energetic fitness coach website with a bold hero with a call-to-action for a free consultation, transformation before-after slider, training programs pricing cards, weekly class schedule table, testimonials, and a contact form.",
    category: "Fitness",
    icon: Dumbbell,
    color: "text-teal-600 bg-teal-50"
  },
  {
    title: "Real Estate",
    prompt: "A luxury real estate agency website with a full-width hero property search bar, featured listings grid with price and bed/bath badges, neighborhood guides, agent profiles, mortgage calculator widget, and a schedule-a-viewing form.",
    category: "Real Estate",
    icon: Building2,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Travel Blog",
    prompt: "An immersive travel blog with a cinematic destination hero, latest-stories grid with country tags, an interactive-style itinerary timeline, photo essay section, packing-list checklist, and a newsletter signup.",
    category: "Travel",
    icon: Plane,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Hair Salon",
    prompt: "A chic hair salon website with a soft editorial hero, services and price menu, stylist team cards, before-and-after gallery, client reviews, and an online booking request form with service picker.",
    category: "Beauty",
    icon: Scissors,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Dental Clinic",
    prompt: "A calming dental clinic website with a friendly hero and book-appointment button, treatments grid, meet-the-dentists section, new-patient FAQ accordion, insurance logos, and a contact and hours panel.",
    category: "Health",
    icon: Stethoscope,
    color: "text-teal-600 bg-teal-50"
  },
  {
    title: "Law Firm",
    prompt: "A trustworthy law firm website with a serif hero and free-consultation button, practice areas grid, attorney profiles, case-results stats, client testimonials, and a confidential contact form.",
    category: "Professional",
    icon: Scale,
    color: "text-slate-600 bg-slate-100"
  },
  {
    title: "Coffee Shop",
    prompt: "A cozy independent coffee shop website with a warm hero, seasonal menu tabs with prices, our-beans story section, photo gallery, loyalty-card explainer, and hours and location with a map embed.",
    category: "Food",
    icon: Coffee,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Startup Launch",
    prompt: "A bold pre-launch startup page with an animated gradient hero, countdown timer, waitlist email form with inline success, feature teasers, founder note, and social proof counters.",
    category: "Marketing",
    icon: Rocket,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Tech Conference",
    prompt: "A high-energy tech conference website with a date-and-venue hero, speaker grid with bios modal, tabbed multi-day schedule, ticket tier cards, sponsors row, and an FAQ accordion.",
    category: "Events",
    icon: Cpu,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Pet Care",
    prompt: "A playful pet grooming and daycare website with a cheerful hero, services cards with pricing, pet-of-the-month gallery, staff bios, vaccination requirements FAQ, and a booking form.",
    category: "Pets",
    icon: PawPrint,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "University Department",
    prompt: "A modern university department website with a hero of campus life, programs and degrees cards, faculty directory with search, research highlights, upcoming events list, and an admissions call-to-action.",
    category: "Education",
    icon: Landmark,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Podcast",
    prompt: "A stylish podcast website with a bold cover-art hero, latest-episodes list with play-button styling and show notes, host bios, guest highlights, subscribe-on-platform buttons, and a listener question form.",
    category: "Media",
    icon: Mic,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Film Production",
    prompt: "A cinematic film studio website with a dark full-bleed hero, featured-projects reel grid with hover previews, director bios, awards laurels row, behind-the-scenes gallery, and a project inquiry form.",
    category: "Media",
    icon: Film,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Fashion Brand",
    prompt: "A minimal fashion brand website with a lookbook hero, new-arrivals grid with quick-view hover, collection filters, brand story, size guide modal, and a newsletter signup with discount teaser.",
    category: "E-commerce",
    icon: Shirt,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Florist",
    prompt: "A romantic florist website with a soft botanical hero, bouquet catalog with filters by occasion, subscription plan cards, wedding services section, delivery area info, and an order-inquiry form.",
    category: "Shops",
    icon: Flower2,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Auto Dealership",
    prompt: "A sleek car dealership website with a hero inventory search, featured vehicles cards with specs, financing calculator, trade-in request form, customer reviews, and hours and directions.",
    category: "Automotive",
    icon: Car,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Winery",
    prompt: "An elegant winery website with a vineyard hero, wine collection cards with tasting notes, tasting-room booking form, wine-club tiers, our-heritage timeline, and visit-us details.",
    category: "Food",
    icon: Wine,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Daycare",
    prompt: "A warm children's daycare website with a bright hero, daily-schedule timeline, programs by age group, safety and staff credentials, parent testimonials, and an enrollment inquiry form.",
    category: "Family",
    icon: Baby,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Community Club",
    prompt: "A welcoming community club website with a hero and join-now button, upcoming events calendar list, membership tiers, member spotlights, photo gallery, and a contact section.",
    category: "Community",
    icon: Users,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Art Gallery",
    prompt: "A refined contemporary art gallery website with a rotating-exhibition hero, current and past exhibitions grid, artist profiles, visit info with hours, membership cards, and an email-list signup.",
    category: "Art",
    icon: Paintbrush,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Surf School",
    prompt: "A sun-soaked surf school website with an ocean hero, lesson packages cards, instructor bios, weekly conditions-and-schedule table, gear rental prices, and a lesson booking form.",
    category: "Sports",
    icon: Waves,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Camping Resort",
    prompt: "An outdoorsy campground website with a forest hero, campsite types cards with amenities icons, seasonal rates table, activity guide, photo gallery, and a reservation request form.",
    category: "Travel",
    icon: Tent,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Consulting Firm",
    prompt: "A sharp management consulting website with a confident hero, services pillars, case-study cards with result metrics, leadership team, insights articles grid, and a contact-us form.",
    category: "Business",
    icon: Briefcase,
    color: "text-slate-600 bg-slate-100"
  },
  {
    title: "Yoga Studio",
    prompt: "A serene yoga studio website with a calming hero, class types cards, weekly timetable with level tags, teacher profiles, membership pricing, and a free-trial signup form.",
    category: "Wellness",
    icon: Heart,
    color: "text-teal-600 bg-teal-50"
  },
  {
    title: "Online Course",
    prompt: "A persuasive online course sales page with a hero and enroll button, what-you'll-learn checklist, curriculum accordion, instructor bio, student results testimonials, pricing card with guarantee, and FAQ.",
    category: "Education",
    icon: GraduationCap,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Architecture Studio",
    prompt: "A minimalist architecture studio website with a large project-image hero, filterable projects grid, studio philosophy statement, team section, press mentions, and a commission inquiry form.",
    category: "Portfolio",
    icon: Building2,
    color: "text-slate-600 bg-slate-100"
  },
  {
    title: "Bakery",
    prompt: "A charming artisan bakery website with a warm hero, daily-bakes menu cards, custom-cake order form with size and flavor pickers, our-story section, market schedule, and location and hours.",
    category: "Food",
    icon: UtensilsCrossed,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Freelance Developer",
    prompt: "A sleek freelance developer portfolio with a code-styled hero, tech-stack badges, case-study project cards, services and rates, testimonials, and a hire-me contact form.",
    category: "Portfolio",
    icon: Cpu,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Hotel & B&B",
    prompt: "A boutique hotel website with a full-bleed hero and check-in/check-out picker, room cards with amenities and rates, dining and spa sections, guest gallery, reviews, and a booking inquiry form.",
    category: "Travel",
    icon: Building2,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Charity Event",
    prompt: "An urgent charity fun-run event website with a bold hero and countdown, fundraising progress bar, route and schedule details, team signup form, sponsor tiers, and an FAQ.",
    category: "Nonprofit",
    icon: Sprout,
    color: "text-emerald-600 bg-emerald-50"
  }
];

export const ASK_STARTER_PRESETS = [
  {
    title: "Explain React Hooks",
    prompt: "Can you explain how React hooks work, specifically useState and useEffect, with simple examples?",
    category: "React",
    icon: Atom,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Tailwind CSS Tips",
    prompt: "What are some best practices for using Tailwind CSS in a large React project?",
    category: "CSS",
    icon: Palette,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Fix a Bug",
    prompt: "I have a bug in my JavaScript code where a variable is undefined. What are the common causes and how do I debug it?",
    category: "Debugging",
    icon: Bug,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Optimize Performance",
    prompt: "What are the most effective ways to optimize the performance of a modern web application?",
    category: "Performance",
    icon: Gauge,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Explain Async/Await",
    prompt: "Can you explain JavaScript Promises and the async/await syntax in a way that is easy to understand?",
    category: "JavaScript",
    icon: Hourglass,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Best Tech Stack",
    prompt: "What is the best modern tech stack for building a fast, scalable web application?",
    category: "Architecture",
    icon: Layers,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Write a Regex",
    prompt: "Can you write and explain a regular expression that validates email addresses?",
    category: "Regex",
    icon: Regex,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Learn TypeScript",
    prompt: "What are the main benefits of using TypeScript over plain JavaScript, and how do I get started?",
    category: "TypeScript",
    icon: Braces,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Database Design",
    prompt: "How should I structure a SQL database for a simple e-commerce store with users, products, and orders?",
    category: "Database",
    icon: Database,
    color: "text-teal-600 bg-teal-50"
  }
];

export const PREVIEW_MODES = {
  mobile: {
    label: 'Smartphone',
    width: 399,
    height: 820,
    deviceClass: 'device-smartphone',
    isTouchChrome: true,
    zoomPadding: { h: 32, v: 32 }
  },
  tablet: {
    label: 'Tablet',
    width: 810,
    height: 1080,
    deviceClass: 'device-tablet',
    isTouchChrome: true,
    zoomPadding: { h: 52, v: 44 }
  },
  desktop: {
    label: 'Desktop',
    width: 1468,
    height: 1022,
    deviceClass: 'device-desktop',
    isTouchChrome: false,
    zoomPadding: { h: 72, v: 54 }
  }
};

// Desktop has no orientation concept (it's a browser window, not a rotatable
// device), so only touch-chrome modes (mobile/tablet) swap width/height here.
