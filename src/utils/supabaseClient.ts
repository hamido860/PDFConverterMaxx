import { loadSupabaseModule } from '../lib/runtimeLoaders';

let supabaseClient: any = null;

export const getSupabase = async (supabaseUrl?: string, supabaseKey?: string) => {
  const url = supabaseUrl || localStorage.getItem('supabaseUrl');
  const key = supabaseKey || localStorage.getItem('supabaseKey');
  if (!url || !key) throw new Error('Supabase credentials are not configured.');
  
  if (!supabaseClient) {
    const { createClient } = await loadSupabaseModule();
    supabaseClient = createClient(url, key);
  }
  return supabaseClient;
};
