import { supabaseEnabled } from '../../supabase';
import supabaseAuthProvider from './supabaseAuthProvider';
import mockAuthProvider from './mockAuthProvider';

export { supabaseEnabled };

const authProvider = supabaseEnabled ? supabaseAuthProvider : mockAuthProvider;

export default authProvider;
