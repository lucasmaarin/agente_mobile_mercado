const session = require('express-session');
const Store = session.Store;

/**
 * Session store usando Firestore
 * Persiste sessoes no Firebase para que o login sobreviva a reinicializacoes
 */
class FirestoreSessionStore extends Store {
    constructor(db, options = {}) {
        super();
        this.db = db;
        this.collection = options.collection || 'sessions';
        this.ttl = options.ttl || 7 * 24 * 60 * 60; // 7 dias em segundos
    }

    async get(sid, callback) {
        try {
            const doc = await this.db.collection(this.collection).doc(sid).get();
            if (!doc.exists) return callback(null, null);

            const data = doc.data();

            // Verifica se expirou
            if (data.expires && data.expires.toDate() < new Date()) {
                this.destroy(sid, () => {});
                return callback(null, null);
            }

            callback(null, data.session);
        } catch (err) {
            callback(err);
        }
    }

    async set(sid, sessionData, callback) {
        try {
            const expires = new Date(Date.now() + this.ttl * 1000);

            await this.db.collection(this.collection).doc(sid).set({
                session: sessionData,
                expires,
                updatedAt: new Date()
            });

            if (callback) callback(null);
        } catch (err) {
            if (callback) callback(err);
        }
    }

    async destroy(sid, callback) {
        try {
            await this.db.collection(this.collection).doc(sid).delete();
            if (callback) callback(null);
        } catch (err) {
            if (callback) callback(err);
        }
    }

    async touch(sid, sessionData, callback) {
        try {
            const expires = new Date(Date.now() + this.ttl * 1000);

            await this.db.collection(this.collection).doc(sid).update({
                expires,
                updatedAt: new Date()
            });

            if (callback) callback(null);
        } catch (err) {
            if (callback) callback(err);
        }
    }
}

module.exports = FirestoreSessionStore;
