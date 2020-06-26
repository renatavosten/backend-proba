import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import storage from './memory_storage.js';
import cors from 'cors';
import connect from './db.js';
import mongo from 'mongodb';
import auth from './auth';

const app = express(); // instanciranje aplikacije
const port = 3000; // port na kojem će web server slušati

app.use(cors());
app.use(express.json()); // automatski dekodiraj JSON poruke

app.get('/tajna', [auth.verify], async (req, res) => {
    // nakon što se izvrši auth.verify middleware, imamo dostupan req.jwt objekt
    res.status(200).send('tajna korisnika ' + req.jwt.username);
});

app.patch('/user', [auth.verify], async (req, res) => {
    let changes = req.body;
    if (changes.new_password && changes.old_password) {
        let result = await auth.changeUserPassword(req.jwt.username, changes.old_password, changes.new_password);
        if (result) {
            res.status(201).send();
        } else {
            res.status(500).json({ error: 'cannot change password' });
        }
    } else {
        res.status(400).json({ error: 'unrecognized request' });
    }
});

app.post('/auth', async (req, res) => {
    let user = req.body;
    let username = user.username;
    let password = user.password;

    try {
        let result = await auth.authenticateUser(username, password);
        res.status(201).json(result);
    } catch (e) {
        res.status(500).json({
            error: e.message,
        });
    }
});

app.post('/user', async (req, res) => {
    let user = req.body;

    try {
        let result = await auth.registerUser(user);
        res.status(201).send();
    } catch (e) {
        res.status(500).json({
            error: e.message,
        });
    }
});

let primjer_middleware = (res, req, next) => {
    console.log('Ja se izvršavam prije ostatka handlera za rutu');
    res.varijabla_1 = 'OK';
    next();
};
let primjer_middleware_2 = (res, req, next) => {
    console.log('I ja se isto izvršavam prije ostatka handlera za rutu');
    res.varijabla_2 = 'isto OK';
    next();
};
app.get('/primjer', [primjer_middleware, primjer_middleware_2], (req, res) => {
    console.log('.. a tek onda se ja izvršavam.');
    console.log(req.varijabla_1);
    console.log(req.varijabla_2);

    res.send('OK');
});

app.patch('/posts/:id', async (req, res) => {
    let doc = req.body;
    delete doc._id;
    let id = req.params.id;
    let db = await connect();

    let result = await db.collection('posts').updateOne(
        { _id: mongo.ObjectId(id) },
        {
            $set: doc,
        }
    );
    if (result.modifiedCount == 1) {
        res.json({
            status: 'success',
            id: result.insertedId,
        });
    } else {
        res.status(500).json({
            status: 'fail',
        });
    }
});

app.put('/posts/:id', async (req, res) => {
    let doc = req.body;
    delete doc._id;
    let id = req.params.id;
    let db = await connect();

    let result = await db.collection('posts').replaceOne({ _id: mongo.ObjectId(id) }, doc);
    if (result.modifiedCount == 1) {
        res.json({
            status: 'success',
            id: result.insertedId,
        });
    } else {
        res.status(500).json({
            status: 'fail',
        });
    }
});

app.post('/posts', async (req, res) => {
    let db = await connect();
    let doc = req.body;

    let result = await db.collection('posts').insertOne(doc);
    if (result.insertedCount == 1) {
        res.json({
            status: 'success',
            id: result.insertedId,
        });
    } else {
        res.json({
            status: 'fail',
        });
    }
});

app.delete('/posts/:postId/comments/:commentId', async (req, res) => {
    let db = await connect();
    let postId = req.params.postId;
    let commentId = req.params.commentId;

    let result = await db.collection('posts').updateOne(
        { _id: mongo.ObjectId(postId) },
        {
            // sada koristimo mongo direktivu $pull za micanje
            // vrijednosti iz odabranog arraya `comments`
            // komentar pretražujemo po _id-u
            $pull: { comments: { _id: mongo.ObjectId(commentId) } },
        }
    );
    if (result.modifiedCount == 1) {
        res.status(201).send();
    } else {
        res.status(500).json({
            status: 'fail',
        });
    }
});
app.post('/posts/:postId/comments', async (req, res) => {
    let db = await connect();
    let doc = req.body;
    let postId = req.params.postId;

    // u mongu dokumenti unutar postojećih dokumenata ne dobivaju
    // automatski novi _id, pa ga moramo sami dodati
    doc._id = mongo.ObjectId();

    // datume je ispravnije definirati na backendu
    doc.posted_at = Date.now();

    let result = await db.collection('posts').updateOne(
        { _id: mongo.ObjectId(postId) },
        {
            // operacija $push dodaje novu vrijednost u
            // atribut `comments`, a ako on ne postoji
            // automatski ga stvara i postavlja na []
            $push: { comments: doc },
        }
    );
    if (result.modifiedCount == 1) {
        res.json({
            status: 'success',
            id: doc._id,
        });
    } else {
        res.status(500).json({
            status: 'fail',
        });
    }
});

app.get('/posts/:id', [auth.verify], async (req, res) => {
    let id = req.params.id;
    let db = await connect();
    let document = await db.collection('posts').findOne({ _id: mongo.ObjectId(id) });

    res.json(document);
});

app.get('/posts', [auth.verify], async (req, res) => {
    let db = await connect();
    let query = req.query;

    let selekcija = {};

    if (query._any) {
        // za upit: /posts?_all=pojam1 pojam2
        let pretraga = query._any;
        let terms = pretraga.split(' ');

        let atributi = ['title', 'createdBy'];

        selekcija = {
            $and: [],
        };

        terms.forEach((term) => {
            let or = {
                $or: [],
            };

            atributi.forEach((atribut) => {
                or.$or.push({ [atribut]: new RegExp(term) });
            });

            selekcija.$and.push(or);
        });
    }

    let cursor = await db.collection('posts').find(selekcija);
    let results = await cursor.toArray();

    res.json(results);
});

app.listen(port, () => console.log(`Slušam na portu ${port}!`));
