import {
  Wand2, ShieldAlert, Smartphone, Code2, Play, Loader2, History, Settings, Layout, Download,
  RefreshCw, Sparkles, ChevronRight, TerminalSquare, Timer, CloudSun, Receipt, ListChecks, Plus,
  Edit2, Clock, ListTodo, Wallet, Undo2, Redo2, FolderOpen, X, Copy, Check, Trash2, ZoomIn, ZoomOut,
  Monitor, Tablet, RotateCw, Moon, Sun, PanelLeftOpen, PanelLeftClose, TriangleAlert, Eye, EyeOff,
  Calculator, KeyRound, Ruler, LogIn, LogOut, User, CloudUpload, Mail, ExternalLink, Zap, Layers,
  Search, Rocket, Globe, MessageSquare, Trophy, Radio, Keyboard, ChefHat, Grid3x3, Brain,
  GraduationCap, Music, Dumbbell, Gamepad2, Dices, Bomb, Target, Flame, Puzzle, Swords, Ghost
} from 'lucide-react';

// Cloudflare Turnstile site key for Supabase auth bot protection. Public by
// design (the matching secret lives in Supabase Auth > Bot and Abuse Protection).
export const TURNSTILE_SITE_KEY = '0x4AAAAAAEj8I1oDBw3Rwb8l';

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
  Wand2, Smartphone, Code2, Layout, TerminalSquare, Timer, CloudSun, Receipt, ListChecks, Edit2, Clock, ListTodo, Wallet, Calculator, KeyRound, Ruler, Zap, Layers, Search, Monitor, Trophy, Radio, Keyboard, Rocket, Gamepad2, Dices, Bomb, Target, Flame, Puzzle, Swords, Ghost
};

export const STARTER_PRESETS = [
  {
    title: "Weather Forecast",
    prompt: "A high-quality weather app built with Material You design and dynamic color palettes. Includes live conditions, 7-day forecast cards, hourly charts, animated weather artwork, and air quality metrics.",
    category: "Weather",
    icon: CloudSun,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Space Shooter",
    prompt: "A complete, fully functional arcade space shooter with touchscreen virtual controls and keyboard support. Features laser cannons, wave-based alien fleets, shield power-ups, and particle explosion effects.",
    category: "Arcade",
    icon: Rocket,
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
    icon: Gamepad2,
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
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "2048 Puzzle",
    prompt: "The addictive 2048 sliding number puzzle with animated tile merging, smooth swipe and keyboard arrow controls, score and best-score displays, undo move button, and victory celebration.",
    category: "Puzzle",
    icon: Dices,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Focus Timer",
    prompt: "A Pomodoro-style focus timer with a smooth animated countdown ring, customizable work/break intervals, an ambient session soundtrack, daily streak tracking, and a running log of completed sessions.",
    category: "Productivity",
    icon: Timer,
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
    icon: Wallet,
    color: "text-teal-600 bg-teal-50"
  },
  {
    title: "Brick Breaker",
    prompt: "An action-packed arcade brick breaker with responsive paddle movement, physics-driven ball bounces, power-ups like multi-ball and laser paddles, sound effects, and multi-tier brick layouts.",
    category: "Arcade",
    icon: Target,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Sudoku Puzzle",
    prompt: "A fully playable Sudoku game with three difficulty levels, pencil-mark notes, mistake highlighting, a solve timer with best-time tracking, and satisfying animations on row/column/box completion.",
    category: "Puzzle",
    icon: Grid3x3,
    color: "text-indigo-600 bg-indigo-50"
  },
  {
    title: "Flashcard Study",
    prompt: "A spaced-repetition flashcard app with swipeable cards, deck creation and editing, a flip animation, confidence-based review scheduling, and per-deck mastery progress tracking.",
    category: "Education",
    icon: GraduationCap,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Word Guess",
    prompt: "A daily 5-letter word guessing game with animated flip tiles, green/yellow/gray letter feedback, an interactive on-screen keyboard, guess distribution stats, and win streak counters.",
    category: "Word",
    icon: Sparkles,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Habit Tracker",
    prompt: "A daily habit tracker with a clean weekly grid view, one-tap check-ins, streak counters with milestone celebrations, per-habit color coding, and a monthly completion heatmap.",
    category: "Productivity",
    icon: ListChecks,
    color: "text-emerald-600 bg-emerald-50"
  },
  {
    title: "Pixel Bird",
    prompt: "A retro pixel-style bird flapping obstacle runner with one-tap physics, scrolling parallax pipes, collision detection, coin pickups, medal achievements, and instant restart.",
    category: "Arcade",
    icon: Flame,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Trivia Quiz",
    prompt: "A fast-paced multi-category trivia quiz with a countdown timer per question, animated score reveal, streak bonuses, a results summary screen, and a high-score leaderboard saved between sessions.",
    category: "Quiz",
    icon: Brain,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Drum Machine",
    prompt: "A playable step-sequencer drum machine with multiple synthesized drum kits, an adjustable BPM, a 16-step pattern grid, pattern save/load slots, and reactive visual pulses on each beat.",
    category: "Audio",
    icon: Music,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Memory Match",
    prompt: "A colorful card matching memory game with 3D flip card animations, emoji pair themes, move counter, accuracy score, combo streak multipliers, and star rating on completion.",
    category: "Memory",
    icon: Puzzle,
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
    title: "Retro Pong",
    prompt: "A fast-paced neon Pong table tennis arcade game with single-player vs smart AI or 2-player local mode, dynamic ball spin, speed acceleration, sound synth pulses, and score display.",
    category: "Arcade",
    icon: Swords,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Unit Converter",
    prompt: "An elegant unit converter covering length, weight, temperature, volume, and currency with live two-way conversion as you type, a recent-conversions history, and quick-swap unit buttons.",
    category: "Utility",
    icon: Ruler,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Whack-a-Mole",
    prompt: "A rapid-reaction whack-a-mole game with animated pop-up critters, bonus gold moles, combo multipliers, hammer smash effects, a 60-second frenzy timer, and local leaderboards.",
    category: "Arcade",
    icon: Ghost,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Connect Four",
    prompt: "A modern Connect Four board game with gravity piece-drop physics, unbeatable Minimax AI mode or local pass-and-play, winning 4-in-a-row highlight animations, and round win stats.",
    category: "Strategy",
    icon: Trophy,
    color: "text-rose-600 bg-rose-50"
  }
];

export const ASK_STARTER_PRESETS = [
  {
    title: "Explain React Hooks",
    prompt: "Can you explain how React hooks work, specifically useState and useEffect, with simple examples?",
    category: "React",
    icon: Code2,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Tailwind CSS Tips",
    prompt: "What are some best practices for using Tailwind CSS in a large React project?",
    category: "CSS",
    icon: Layout,
    color: "text-sky-600 bg-sky-50"
  },
  {
    title: "Fix a Bug",
    prompt: "I have a bug in my JavaScript code where a variable is undefined. What are the common causes and how do I debug it?",
    category: "Debugging",
    icon: TerminalSquare,
    color: "text-rose-600 bg-rose-50"
  },
  {
    title: "Optimize Performance",
    prompt: "What are the most effective ways to optimize the performance of a modern web application?",
    category: "Performance",
    icon: Zap,
    color: "text-amber-600 bg-amber-50"
  },
  {
    title: "Explain Async/Await",
    prompt: "Can you explain JavaScript Promises and the async/await syntax in a way that is easy to understand?",
    category: "JavaScript",
    icon: Code2,
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
    icon: Search,
    color: "text-violet-600 bg-violet-50"
  },
  {
    title: "Learn TypeScript",
    prompt: "What are the main benefits of using TypeScript over plain JavaScript, and how do I get started?",
    category: "TypeScript",
    icon: Code2,
    color: "text-blue-600 bg-blue-50"
  },
  {
    title: "Database Design",
    prompt: "How should I structure a SQL database for a simple e-commerce store with users, products, and orders?",
    category: "Database",
    icon: ListTodo,
    color: "text-teal-600 bg-teal-50"
  }
];

export const PREVIEW_MODES = {
  mobile: {
    label: 'Mobile',
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