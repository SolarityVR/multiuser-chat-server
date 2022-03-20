require('dotenv').config();
const express = require('express');
const app = express();
const server = require('http').createServer(app);

const DbConnect = require('./config/db');
const router = require('./routes');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const ACTIONS = require('./config/actions');

const roomService = require('./services/room-service');
///////////////////-For Deploying Server-///////////////////////////
// ... other imports 
const path = require("path")

// ... other app.use middleware 
app.use(express.static(path.join(__dirname, "client", "build")))

// ...
// Right before your app.listen(), add this:
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "client", "build", "index.html"));
});
//////////////////////////////////////////////////////////////////

const io = require('socket.io')(server, {
    cors: {
        origin: "https://cool-server-app.herokuapp.com",
        methods: ["GET", "POST"],
        credentials: true
    }
});

// DbConnect();

app.use(express.json({ limit: '8mb' }));
app.use(cookieParser());
app.use('/storage', express.static('storage'));

app.use(cors({
    credentials: true,
    origin: process.env.FRONT_URL
}));

app.use(router);
const PORT = process.env.PORT || 4000;

const socketUserMapping = {}
var roomIndex = 0;

//aframe
const rooms = {};
////////////
io.on('connection', (socket) => {

  //aframe
  let curRoom = null;

  socket.on("send", data => {
    if(!!socket.username) {
        data['name'] = socket.username;
    }
    io.to(data.to).emit("send", data);
  });

  socket.on("broadcast", data => {
    if(!!socket.username) {
        data['name'] = socket.username;
    }
    socket.to(curRoom).emit("broadcast", data);
  });

  /////////////////////////////////////

    console.log('new connection', socket.id);
    socket.socket_id = socket.id;

    socket.on(ACTIONS.JOIN, async ({ roomId, user }) => {
        socketUserMapping[socket.id] = user;
        
        if(roomId == -1) {
            roomId = roomService.create(roomIndex, {name: user.name, sid: socket.id});
            socket.emit(ACTIONS.ROOM_READY, {roomId});
            roomIndex ++;
            return;
        } else {
            roomService.joinRoom(roomId, {name: user.name, sid: socket.id});
        }

        ////////////////////- Aframe Content -////////////////////
        curRoom = 'room' + roomId;
        if (!rooms[curRoom]) {
            rooms[curRoom] = {
              name: roomId,
              occupants: {},
            };
        }
    
        const joinedTime = Date.now();
        rooms[curRoom].occupants[socket.id] = joinedTime;
        socket.emit("connectSuccess", { joinedTime, curRoom });
        const occupants = rooms[curRoom].occupants;
        /////////////////////////////////////////////////////////

        socket.username = user.name
        socket.roomId = roomId;

        const room = await roomService.getRoom(roomId);
        if(!!room) {
            socket.emit(ACTIONS.CREATE_ROOM, {roomId, msgs: room.msgs});
            io.sockets.emit(ACTIONS.ROOM_LIST, {rooms: roomService.getAllRooms()});

            clients= room.clients.filter(s => s != socket.id) || [];
            clients.forEach(clientId => {
                io.to(clientId).emit(ACTIONS.ADD_PEER, {
                    peerId: socket.id,
                    createOffer: false,
                    user
                });

                socket.emit(ACTIONS.ADD_PEER, {
                    peerId: clientId,
                    createOffer: true,
                    user: socketUserMapping[clientId]
                });
            });

            socket.join('room' + roomId);
            io.in(curRoom).emit("occupantsChanged", { occupants });
            console.log(`${socket.id} joined in room ${roomId}`);
        }
    });

    socket.on(ACTIONS.ROOM_LIST, () => {
        io.sockets.emit(ACTIONS.ROOM_LIST, {rooms: roomService.getAllRooms()});
    })

    socket.on(ACTIONS.SEND_MSG, ({roomId, data}) => {
        io.to('room' + roomId).emit(ACTIONS.SEND_MSG, {user: socket.username, msg: data});
        roomService.addMsg(roomId, {user: socket.username, msg: data});
    })

    // handel relay ice
    socket.on(ACTIONS.RELAY_ICE, ({ peerId, iceCandidate }) => {
        io.to(peerId).emit(ACTIONS.ICE_CANDIDATE, {
            peerId: socket.id,
            iceCandidate
        })
    })

    socket.on(ACTIONS.RELAY_SDP, ({ peerId, sessionDescription }) => {
        io.to(peerId).emit(ACTIONS.SESSION_DESCRIPTION, {
            peerId: socket.id,
            sessionDescription
        })
    })

    // mute or unmute the user
    socket.on(ACTIONS.MUTE, ({ roomId, name }) => {
        const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
        clients.forEach((clientId) => {
            io.to(clientId).emit(ACTIONS.MUTE, {
                peerId: socket.id,
                name
            })
        })
    })

    socket.on(ACTIONS.UNMUTE, ({ roomId, name }) => {
        const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
        clients.forEach((clientId) => {
            io.to(clientId).emit(ACTIONS.UNMUTE, {
                peerId: socket.id,
                name
            })
        })
    })

    // leaving the room 
    const leaveRoomFunc = async ({roomId, user}) => {

        //////////////////////- Aframe -////////////////////////
        if (rooms[curRoom]) {
            console.log("user disconnected", socket.id);
      
            delete rooms[curRoom].occupants[socket.id];
            const occupants = rooms[curRoom].occupants;
            socket.to(curRoom).emit("occupantsChanged", { occupants });
      
            if (Object.keys(occupants).length === 0) {
              console.log("everybody left room");
              delete rooms[curRoom];
            }
        }
        ////////////////////////////////////////////////////////

        room = await roomService.getRoom(roomId);
        if(!!room) {
            var clients = room.clients.filter(s => s != socket.id);
    
            clients.forEach((clientId) => {
                io.to(clientId).emit(ACTIONS.REMOVE_PEER, {
                    peerId: socket.id,
                    name: user.name,
                    user
                })
            })
            socket.leave('room' + roomId);
            socket.roomId = -1;
            roomService.leaveRoom(roomId, {name: user.name, sid: socket.id});
            io.sockets.emit(ACTIONS.ROOM_LIST, {rooms: roomService.getAllRooms()});
            delete socketUserMapping[socket.id];
        }
    };

    socket.on(ACTIONS.LEAVE, leaveRoomFunc)
    socket.on('disconnect', () => {
        leaveRoomFunc({roomId: socket.roomId, user: {name: socket.username}});
        console.log('disconnection ' + socket.socket_id);
    })
});

server.listen(PORT, () => console.log(`Listening on port ${PORT}`));



