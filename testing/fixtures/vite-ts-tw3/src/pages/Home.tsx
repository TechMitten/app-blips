import { useState } from "react"
import { motion } from "framer-motion"
import { Heart } from "lucide-react"
import { Button } from "@/components/ui/button"
import hero from "@/assets/hero.png"

export default function Home() {
  const [likes, setLikes] = useState<number>(0)
  return (
    <main className="p-8">
      <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-4xl font-bold" id="headline">
        Fresh bread every morning
      </motion.h1>
      <img src={hero} alt="Hero" id="hero" className="my-4 h-8 w-8" />
      <Button id="like" onClick={() => setLikes((n) => n + 1)}>
        <Heart className="mr-2 h-4 w-4" /> {likes}
      </Button>
      <p className="text-muted-foreground" id="email">{import.meta.env.VITE_CONTACT_EMAIL}</p>
    </main>
  )
}
