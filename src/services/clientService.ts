import { supabase } from './supabase';
import { Database } from '../types/supabase';
import { saveClientWithDeduplication } from '../utils/clientDuplicates';

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
        const result = await saveClientWithDeduplication(client, { onDuplicate: 'merge' });
        return result.client as Client;
    },


};
