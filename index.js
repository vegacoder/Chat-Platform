const mongoose = require('mongoose');
const express = require('express');
const bodyParser = require('body-parser');
const { graphqlHTTP } = require('express-graphql');
const schema = require('./Schema/Schema');
const cors = require('cors');
const { URI } = require('./keys/keys');
var socket = require('socket.io');
const jwt = require('jsonwebtoken');
const _ = require('lodash');
const Groups = require('./models/Group')

// used for making room id
const compareFunc = (a, b) => {
    return ('' + a).localeCompare(b,'en', { numeric: true });
}

const app = express();


app.use(cors());
app.use( bodyParser.json() );

// having options to connect to the db
options = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    useFindAndModify:false
}

// connecting to the db
mongoose.connect(URI, options);

// adding event listeners
mongoose.connection.once('connected', ()=>{
    console.log("Connected to the Database!");
}).on('error', ()=>{
    console.log("Error connecting to the Database!");
});

// graphql route
app.use('/graphql',graphqlHTTP({
    schema,
    graphiql: true
}));

// listening on port
PORT = process.env.PORT || 1000;
const server = app.listen(PORT, ()=>{
    console.log("Listening to requests on port", PORT);
})

var io = socket(server);

// server db for keeping a record of users and sockets
const users = {};
const priv = {};
const groups = {};
var myGroups = {};

io.on('connection',(socket)=>{

    // when user disconnects
    socket.on('disconnect', (test)=>{
        io.emit('delStat', { id: socket.nick });
        console.log("Socket:",socket.nick);
        const temp = removeUser(socket.nick);
        console.log("Temp:",temp);
        if(temp){
            console.log("User has disconnected!");
        }else{
            console.log("User wasn't present!")
        }
        removeFromExistingRooms(socket.nick, myGroups[socket.nick], "Test")

    });

    // typing feature here
    socket.on('typing', (data, callback) => {
        io.emit('updateStat', { id: data.from });
        let tempto = [data.from, data.to].sort(compareFunc);
        let roomId = jwt.sign(tempto[0], tempto[1]);
        if(roomExist(roomId)){
            let result = {
                msgFormat: `${data.name} is typing`,
                source: data.from,
            }
            socket.to(roomId).emit('type', result);
            callback(true);
        }else{
            callback(false);
        }
    });

    // stop typing feature here
    socket.on('stop-typing', (data, callback) => {
        io.emit('updateStat', { id: data.from });
        let tempto = [data.from, data.to].sort(compareFunc);
        let roomId = jwt.sign(tempto[0], tempto[1]);
        if(roomExist(roomId)){
            socket.to(roomId).emit('stop-type');
            callback(true);
        }else{
            callback(false);
        }
    });

    // added private chat logic here
    socket.on('sendPriv', (data, callback)=>{
        io.emit('updateStat', { id: data.from });
        let tempto = [data.from, data.to].sort(compareFunc);
        let roomId = jwt.sign(tempto[0], tempto[1]);
        if(roomExist(roomId,data.from, data.to)){
            let msgFormat = {
                "sender": {
                    "name": data.name,
                    "_id":data.from,
                    "__typename": "User"
                },
                "time": data.time,
                "text": data.message,
                "bonus": [tempto[0], tempto[1]]
            }
            io.in(roomId).emit('comm', msgFormat);
            console.log("Room exiists")
            callback(true);
        }else{
            callback(false);
        }
    });


    // join priv chat room for personal DM
    socket.on('privChat', (data)=>{
        io.emit('updateStat', { id: data.from });
        
        let tempto = [data.from, data.to].sort(compareFunc);
        let roomId = jwt.sign(tempto[0], tempto[1]);
        if(users[tempto[0]] && users[tempto[1]]){
            priv[roomId] = [tempto[0], tempto[1]];
            console.log("Room made!",priv);
            users[tempto[0]].join(roomId);
            users[tempto[1]].join(roomId);
            console.log("\nAll users are in!");
            console.log(roomId);
            console.log("PrivRoom",priv[roomId]);
        }else{
            console.log("Try One of the user isn't online!");
        }
    })

    // join a group on tapping the button
    socket.on('group', async (data)=>{
        console.log("Groups:",groups)
        if(data.room in groups){
            users[data.id].join(data.room);
            let obj= {
                id: data.room,
                msg: `${data.name} has joined the chat`
            }
            socket.to(data.room).emit('joinedChat', obj);
            console.log("\nRoom already present!");
            console.log("\n\nRoom",groups[data.room]);
        }else{
            groups[data.room] = "Test";
            users[data.id].join(data.room);
            let obj= {
                id: data.room,
                msg: `${data.name} has joined the chat`
            }
            socket.to(data.room).emit('joinedChat', obj);
            console.log("MyGroups",myGroups)
            for(i = 0; i < myGroups.length; ++i){
                if(data.room === myGroups[i]._id){
                    console.log("Same!")
                    let members = myGroups[i].members;
                    // get all clients in this room
                //     var clients = io.sockets.adapter.rooms[data.room].sockets;
                //     var joinedSockets = [];
                //     for (var clientId in clients ) {
                //         //this is the socket of each client in the room.
                //         var clientSocket = io.sockets.connected[clientId];
                //         joinedSockets.append(clientSocket.nick)
                //    }
                //    console.log(joinedSockets)
                    for (member of members){
                        console.log("Mem", member);
                        // if(users[member] && joinedSockets.includes(member) ){
                        //     console.log("here")
                        //     continue;
                        // }else if(users[member] && !joinedSockets.includes(member)){
                        //     users[member].join(data.room);
                        //     console.log("Joined a new person!");
                            // io.in(data.room).emit('big-announcement', 'the game will start soon');
                            // }
                        let obj= {
                            id: data.room,
                            msg: `${data.name} is online`
                        }
                        if(users[member]){
                            users[member].join(data.room);
                            io.in(data.room).emit('joinedChat', obj);
                        }
                    }
                    break;
                }
            }
        }
    })

    // custom ting for adding a new user / updating his socket
    socket.on('newUser', async ({ id }, callback)=>{
        addUser({ id });
        console.log("No:", (Object.keys(users)).length);
        io.emit('updateStat', { id });
        callback(true);
        myGroups[id] = await Groups.find({ "members": {
            $in: [id]
        } });
        console.log("Welp",myGroups[id])
        joinToExistingRooms(id, myGroups[id]);
    });

    // think this is useless
    socket.on('sendMessage', (message, to, callback)=>{
        console.log("Message:",message,"to:",to);
        callback();
    })

    // helper functions
    const addUser = ({ id }) => {
        id = id.trim();
        socket.nick = id;
        users[socket.nick] = socket;
    };

    const joinToExistingRooms = (id, g) =>{
        if (g.length !== 0){
            for(i = 0; i < g.length; i++){
                if(g[i]._id in groups){
                    users[id].join(g[i]._id);
                    // emitting an event that says user is online
                    console.log("User is online")
                    let obj= {
                        id: g[i]._id,
                        msg: ``
                    }
                    socket.to(g[i]._id).emit('joinedChat', obj);
                }
            }
        }
    }

    const removeFromExistingRooms = (id, g, name) =>{
        if (g.length !== 0){
            for(i = 0; i < g.length; i++){
                if(g[i]._id in groups){
                    if(users[id]){
                        console.log(users[id])
                        users[id].leave(g[i]._id);
                        // emitting an event that says user is online
                        console.log("User has left")
                        let obj= {
                            id: g[i]._id,
                            msg: `${name} has left the chat`
                        }
                        socket.to(data.room).emit('joinedChat', obj);
                        
                    }
                }
            }
        }
    }

    const roomExist = (room, from=null, to=null) => {
        if(room in priv){
            return true;
        }else if(from && to){
            let tempto = [from, to].sort(compareFunc);
            let roomId = jwt.sign(tempto[0], tempto[1]);
            console.log(users[tempto[0]])
            console.log(users[tempto[1]])
            if(users[tempto[0]] && users[tempto[1]]){
                priv[roomId] = [tempto[0], tempto[1]];
                console.log("Room made!",priv);
                users[tempto[0]].join(roomId);
                users[tempto[1]].join(roomId);
                console.log("\nAll users are in!");
                console.log(roomId);
                console.log("PrivRoom",priv[roomId]);
                return true
            }else{
                console.log("One of the user isn't online!");
                return false;
            }
        }
        return false;
    }
    
    const removeUser = (id) => {
        if(id in users){
            for (var key of Object.keys(priv)){
                let temp = priv[key].includes(id)
                if(temp){
                    console.log("Room",temp)
                    delete priv[key]
                }
            }
            delete users[id];
            return true;
        }else{
            return false;
        }
    }
    
})