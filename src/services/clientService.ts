import { supabase } from './supabase';
import { Database } from '../types/supabase';

type Client = Database['public']['Tables']['clients']['Row'];
type ClientInsert = Database['public']['Tables']['clients']['Insert'];

export const clientService = {
    async getClients(userId?: string) {
        let query = supabase
            .from('clients')
            .select('*')
            .order('name');

        if (userId) {
            query = query.eq('created_by', userId);
        }

        const { data, error } = await query;
        if (error) throw error;
        return (data as any) as Client[];
    },

    async createClient(client: ClientInsert) {
        const { data, error } = await (supabase.from('clients') as any)
            .insert(client)
            .select() // Return the inserted data so we can update state immediately
            .single();
        if (error) throw error;
        return data as Client;
    },


};
