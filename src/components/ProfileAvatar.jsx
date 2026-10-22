import { Bird, Bot, Cat, Dog, Fish, Gamepad2, Ghost, Panda, Pizza, Rabbit, Rocket, Turtle, User } from 'lucide-react';

// Icons rather than emoji: emoji depend on the system font (some Linux
// installs have no colour emoji at all), these look the same everywhere.
const AVATARS = {
  rocket: { Icon: Rocket, color: '#ec6452' },
  cat: { Icon: Cat, color: '#f59e0b' },
  dog: { Icon: Dog, color: '#a16207' },
  panda: { Icon: Panda, color: '#475569' },
  rabbit: { Icon: Rabbit, color: '#db2777' },
  turtle: { Icon: Turtle, color: '#16a34a' },
  bird: { Icon: Bird, color: '#0ea5e9' },
  fish: { Icon: Fish, color: '#2563eb' },
  ghost: { Icon: Ghost, color: '#7c3aed' },
  bot: { Icon: Bot, color: '#0d9488' },
  pizza: { Icon: Pizza, color: '#ea580c' },
  gamepad: { Icon: Gamepad2, color: '#9333ea' },
};

// The icon on its colour, or the plain person icon when none was chosen.
export default function ProfileAvatar({ avatar, size = 18 }) {
  const choice = AVATARS[avatar];
  if (!choice) return <User size={size} />;
  return (
    <span className="profile-avatar" style={{ '--avatar-color': choice.color }}>
      <choice.Icon size={size} />
    </span>
  );
}
