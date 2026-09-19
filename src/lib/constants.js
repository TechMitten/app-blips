import {
  Wand2, ShieldAlert, Smartphone, Code2, Play, Loader2, History, Settings, Layout, Download,
  RefreshCw, Sparkles, ChevronRight, TerminalSquare, Timer, CloudSun, Receipt, ListChecks, Plus,
  Edit2, Clock, ListTodo, Wallet, Undo2, Redo2, FolderOpen, X, Copy, Check, Trash2, ZoomIn, ZoomOut,
  Monitor, Tablet, RotateCw, Moon, Sun, PanelLeftOpen, PanelLeftClose, TriangleAlert, Eye, EyeOff,
  Calculator, KeyRound, Ruler, LogIn, LogOut, User, CloudUpload, Mail, ExternalLink, Zap, Layers,
  Search, Rocket, Globe, MessageSquare, Trophy, Radio, Keyboard, ChefHat,
  GraduationCap, Music, Dumbbell, Gamepad2, Dices, Bomb, Target, Flame, Puzzle, Swords, Ghost,
  Worm, WholeWord, CalendarCheck, PiggyBank, Shapes, Drum, Hammer, CircleDot, CircleDotDashed,
  Atom, Palette, Bug, Gauge, Regex, Database, Braces, Hourglass, Bird, Blocks, Coins,
  Briefcase, Camera, UtensilsCrossed, Store, Newspaper, BookOpen, Heart, Sprout, Package,
  Building2, Plane, Scissors, Stethoscope, Scale, Coffee, Cpu, PawPrint, Landmark, Mic, Film,
  Shirt, Flower2, Car, Wine, Baby, Users, Paintbrush, Waves, Tent
} from 'lucide-react';

// The two studios share one workspace pipeline (prompt -> code -> versions);
// the mode changes the prompts, starter ideas, default preview device and the
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
    description: 'Interactive tools, games, and dashboards — JavaScript-driven, saves your data, feels native on a phone.',
  },
  website: {
    key: 'website',
    label: 'Website',
    article: 'website',
    untitledName: 'Untitled Website',
    defaultPreviewMode: 'desktop',
    description: 'Content-first pages — landing pages, portfolios, blogs — that you edit by clicking them in the preview.',
  },
};

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
  }
];

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