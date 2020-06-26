import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import data from './store';
import cors from 'cors';
import connect from './db.js';
import mongo from 'mongodb';
import auth from './auth.js';

const app = express(); // instanciranje aplikacije
const port = process.env.PORT || 3000; // port na kojem će web server slušati

app.use(cors());
app.use(express.json());


let checkAttributes= (data)=>{
    if (!data.naziv || !data.priprema || !data.vrijeme_pripreme || !data.inputKategorija || !data.slika){
        console.log("provjera atributa");
        return false;
    }
    return true;
};

app.patch('/recepti/:id', [auth.verify], async (req, res) => {
  let id = req.params.id;
  let data = req.body;

  delete data._id

  let db = await connect();

  let result = await db.collection("recepti").updateOne({ _id: mongo.ObjectId(id) }, 
                    {
                        $push: { ocjena: parseInt(data.ocjena)}
                    });
  
  

    if (result && result.modifiedCount == 1) {
        let doc = await db.collection("recepti").findOne({ _id: mongo.ObjectId(id)});
        res.json(doc);
    } else {
        res.json({
            status: 'fail',
        });
    }
});

app.get('/tajna', [auth.verify], (req, res) => {
    res.json({ message: 'Ovo je tajna ' + req.jwt.username });
});

// recepti po id-u
app.get('/recepti/:id', [auth.verify], async (req,res )=> {
    let id= req.params.id;
    let db = await connect();
    
    let doc= await db.collection("recepti").findOne({_id: mongo.ObjectId(id)});
    console.log(doc);
    res.json(doc);
    
});
    
app.get('/recepti', [auth.verify], async (req, res) => {
    let db = await connect();
    let query = req.query;
    console.log(query);
  
    let selekcija = {};
   
    if (query._any) {
      let pretraga = query._any;
      let terms = pretraga.split(' ');
  
      let atributi = ['naziv', 'sastojci', 'inputKategorija' ];
  
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
  
    console.log('Selekcija', selekcija); 
  
    let cursor = await db.collection('recepti').find(selekcija);
    let results = await cursor.toArray();
    res.json(results);
});



//dohvat komentara
app.get('/recepti/:receptId/comments', [auth.verify], async (req, res) => {
    let receptId = req.params.receptId;
    let db = await connect();

    let doc = await db.collection('comments').find({receptId: receptId});
    let results = await doc.toArray();
    console.log(results);
    res.json(results);
});

//dohvat korisnikovih recepata u moji recepti
app.get('/recepti/username/:username', [auth.verify], async (req, res) => {
    let username = req.params.username;
    let db = await connect();
    console.log("povezani smo");
    let doc = await db.collection('recepti').find({'username': username});
    let results = await doc.toArray();
    console.log(results);
    res.json(results);

}); 

//dohvat korisnikovih favorita u moji favoriti
app.get('/users/:username/favoriti', [auth.verify], async (req, res) => {
    let username = req.params.username;
    let db = await connect();

    let rezultat = await db.collection('favoriti').aggregate([
        { $match: {username: username} },
        { $lookup: {
            from: "recepti",
            localField: "receptId",
            foreignField: "_id",
            as: "receptidetails"
            }
        }
    ])
    let results = await rezultat.toArray();
    console.log(results);
    res.json(results);
})

app.post('/auth', async (req, res) => {
    let user = req.body;

    try {
        let result = await auth.authenticateUser(user.username, user.password);
        res.json(result);
    } catch (e) {
        res.status(401).json({ error: e.message });
    }

});

app.post('/users', async (req, res) => {
    let user = req.body;

    let id;
    try {
        id = await auth.registerUser(user);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }

    res.json({ id: id });
});

app.patch('/users', [auth.verify], async (req, res) => {
    console.log("Backend change password");
    let changes = req.body;   //podaci koje korisnik šalje na promjenu
    let username = req.jwt.username;

    console.log("changes stara lozinka " + changes.old_password);
    console.log("changes nova lozinka " + changes.new_password)
    
    try {
        if(changes.new_password && changes.old_password) {
            console.log("usao u promjenu lozinke");
            let result = await auth.changeUserPassword(username, changes.old_password, changes.new_password);
            if (result) {
                res.status(201).send();
            } else {
                console.log("saljem gresku");
                res.status(500).json({ error: 'cannot change password' });
            }
        }
        else {
            console.log("usao u gresku")
            res.status(400).json({error: "krivi upit"})
        }
    } catch (e) {
        console.log("nisam usao u backend " + e);
    }
    

});

app.post('/recepti', [auth.verify], async (req, res) => {
    let data= req.body;
    //zelimo validan id pa pustamo da ga mongo postavi
    delete data._id;

    let check= checkAttributes(data);
    if(!check){
        res.json({
            status: "fail",
            reason:"incomplete post",
        });
        return 
    }
    
    let db = await connect();

    let result= await db.collection("recepti").insertOne(data);
    

    if(result && result.insertedCount == 1){
        res.json(result.ops[0]);
    }
    else {
        res.json({
            status: "fail",
        });
    }
});

//unos komentara
app.post('/recepti/:receptId/comments', [auth.verify], async (req, res) => {
    let db = await connect();
    let doc = req.body;
    
    doc.receptId = req.params.receptId;
    
    let result = await db.collection('comments').insertOne(doc);
    if(result.insertedCount == 1) {
        res.json({
            status: 'success',
            });
    } else {
        res.statusCode = 500;
        res.json({
            status: 'fail',
        });
    }

});

//unos favorita
app.post('/users/:username/:receptId/favoriti', [auth.verify], async (req, res) => {
    let db = await connect();
    let doc = req.body;

    doc.username = req.params.username;
    doc.receptId = mongo.ObjectId(req.params.receptId);

    let result = await db.collection('favoriti').insertOne(doc);
    if(result.insertedCount == 1) {
        res.json({
            status: 'success',
            });
    } else {
        res.statusCode = 500;
        res.json({
            status: 'fail',
        });
    }
})

//brisanje komentara
app.delete('/recepti/:receptId/comments/:commentId', [auth.verify], async (req, res) => {
    let db = await connect();
    let commentId = req.params.commentId;

    let result = await db.collection('comments').deleteOne( 
        { _id: mongo.ObjectId(commentId) },
    );

    if(result.deletedCount == 1) {
        res.statusCode = 201;
        res.send();
    } else {
        res.statusCode = 500;
        res.json({
            status: 'fail',
        });
    }
})

app.listen(port, () => console.log(`Slušam na portu ${port}!`));