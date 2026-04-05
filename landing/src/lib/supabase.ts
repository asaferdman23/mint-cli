import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://srhoryezzsjmjdgfoxgd.supabase.co'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNyaG9yeWV6enNqbWpkZ2ZveGdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNjU4NTMsImV4cCI6MjA5MDk0MTg1M30.hQIf14rZiAl-NhC8HDa7ZIORWJiAa1Z5aw1LAzUtY2Q'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
