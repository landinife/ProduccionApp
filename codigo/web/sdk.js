// SDK de Firebase cargado desde el sitio oficial de Google (no hace falta instalar nada)
export { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
export { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
export { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, onSnapshot, writeBatch, query, orderBy, limit, FieldPath, deleteField, setDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
