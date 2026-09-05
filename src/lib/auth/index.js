import { firebaseEnabled } from '../../firebase';
import firebaseAuthProvider from './firebaseAuthProvider';
import mockAuthProvider from './mockAuthProvider';

export { firebaseEnabled };

const authProvider = firebaseEnabled ? firebaseAuthProvider : mockAuthProvider;

export default authProvider;
