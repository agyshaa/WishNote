// lib/supabase/types.ts
// Type definitions for Supabase tables

export type Wishlist = {
  id: string
  user_id: string
  name: string
  description: string
  emoji: string
  is_private: boolean
  access_key: string | null
  created_at: string
  updated_at: string
}

export type WishlistItem = {
  id: string
  wishlist_id: string
  title: string
  price: number
  old_price: number | null
  image: string
  store: string
  url: string
  priority: string
  notes: string
  is_booked: boolean
  booked_by_id: string | null
  added_at: string
}

export type DatabaseUser = {
  id: string
  email: string
  name: string | null
  username: string
  avatar: string
  bio: string
  is_admin: boolean
  created_at: string
  updated_at: string
}
