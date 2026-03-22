import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'

export async function getUserWishlists(userId: string) {
  const cookieStore = await cookies()
  const supabase = createClient(cookieStore)

  const { data, error } = await supabase
    .from('wishlists')
    .select('*')
    .eq('user_id', userId)

  if (error) {
    console.error('Error fetching wishlists:', error)
    return []
  }

  return data || []
}

export async function getWishlistItems(wishlistId: string) {
  const cookieStore = await cookies()
  const supabase = createClient(cookieStore)

  const { data, error } = await supabase
    .from('wishlist_items')
    .select('*')
    .eq('wishlist_id', wishlistId)

  if (error) {
    console.error('Error fetching items:', error)
    return []
  }

  return data || []
}

export async function createWishlist(
  userId: string,
  name: string,
  description: string = '',
  emoji: string = '🎁'
) {
  const cookieStore = await cookies()
  const supabase = createClient(cookieStore)

  const { data, error } = await supabase
    .from('wishlists')
    .insert([{ user_id: userId, name, description, emoji }])
    .select()

  if (error) {
    console.error('Error creating wishlist:', error)
    throw error
  }

  return data?.[0]
}

export async function deleteWishlist(wishlistId: string) {
  const cookieStore = await cookies()
  const supabase = createClient(cookieStore)

  const { error } = await supabase
    .from('wishlists')
    .delete()
    .eq('id', wishlistId)

  if (error) {
    console.error('Error deleting wishlist:', error)
    throw error
  }
}

export async function addWishlistItem(
  wishlistId: string,
  title: string,
  price: number = 0,
  url: string = '',
  notes: string = ''
) {
  const cookieStore = await cookies()
  const supabase = createClient(cookieStore)

  const { data, error } = await supabase
    .from('wishlist_items')
    .insert([{ wishlist_id: wishlistId, title, price, url, notes }])
    .select()

  if (error) {
    console.error('Error adding item:', error)
    throw error
  }

  return data?.[0]
}

export async function deleteWishlistItem(itemId: string) {
  const cookieStore = await cookies()
  const supabase = createClient(cookieStore)

  const { error } = await supabase
    .from('wishlist_items')
    .delete()
    .eq('id', itemId)

  if (error) {
    console.error('Error deleting item:', error)
    throw error
  }
}
