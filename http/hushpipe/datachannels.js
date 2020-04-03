const DATACHAN_CONF = {
  ordered: false, 
  maxRetransmits: 0,
//  maxPacketLifeTime: null,
  protocol: "",
//  negotiated: false,
};

const PEER_CONNECTION_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478?transport=udp" }
  ]
};

function isError(signal) {
  var isPluginError =
      signal.plugindata &&
      signal.plugindata.data &&
      signal.plugindata.data.success === false;
  return isPluginError || Minijanus.JanusSession.prototype.isError(signal);
}

function receiveMsg(session,ev) {
  session.receive(JSON.parse(ev.data))
  //console.log(ev.data);
}

function janus_connect(ctx, server) {
  console.log("1 ctx in janus_connect: ", ctx);

  var ws = new WebSocket(server, "janus-protocol");
  var session = ctx.session = new Minijanus.JanusSession(ws.send.bind(ws), { verbose: true });
  session.isError = isError;
  ws.addEventListener("message", ev => receiveMsg(session,ev));


  ws.addEventListener("open", (socket) => {

    ctx.session.create()
    .then( function pub (something) {
        console.log("ctx in janus_connect: ", ctx);
        attachPublisher(ctx);
    }).then(x => { ctx.publisher = x; }, err => console.error("Error attaching publisher: ", err));

    /*
      .then(ctx => attachPublisher(ctx, session))
      .then(x => { publisher = x; }, err => console.error("Error attaching publisher: ", err));
      */
  });
}
function addUser(ctx, userId) {
   console.log("ctx in addUser: ", ctx);

  console.info("Adding user " + userId + ".");
  return attachSubscriber(ctx, userId)
    .then(x =>   { ctx.subscribers[userId] = x; }, err => console.error("Error attaching subscriber: ", err));
}

function removeUser(ctx, userId) {
  console.info("Removing user " + userId + ".");
  var subscriber = c.subscribers[userId];
  if (subscriber != null) {
    subscriber.handle.detach();
    subscriber.conn.close();
    delete c.subscribers[userId];
  }
}

let firstMessageTime;

function storeMessage(data, reliable) {
  if (!firstMessageTime) {
    firstMessageTime = performance.now();
  }
  messages.push({
    time: performance.now() - firstMessageTime,
    reliable,
//    message: JSON.parse(data)
    message: data,
  });
  updateMessageCount();
}

function storeReliableMessage(ev) {
  storeMessage(ev.data, true);
}

function storeUnreliableMessage(ev) {
  storeMessage(ev.data, false);
}

function storeVideoMessage(ev, from) {
  storeMessage(ev.data, false);
  console.log('videomessage from: ' + from )
  console.log(ev.data);
}

function waitForEvent(name, handle) {
  return new Promise(resolve => handle.on(name, resolve));
}

function addExisting(conn, handle, debugmsg) {
 // handle is plugin handle, conn is peerconnection 
conn.createOffer(
    {
      media: { addData: true },
        success: function(jsep) {
            Janus.debug(jsep);
            //echotest.send({message: {audio: true, video: true}, "jsep": jsep});
        },
        error: function(error) {
            console.log("renegotiate error " + JSON.stringify(error));
        }
    }); 
}


function associate(conn, handle, debugmsg) {
  conn.addEventListener("icecandidate", ev => {
    handle.sendTrickle(ev.candidate || null).catch(e => console.error("Error trickling ICE: ", e));
  });
  conn.addEventListener("negotiationneeded", _ => {
    console.info("Sending new offer for handle: ", handle, debugmsg);
    var offer = conn.createOffer();
    var local = offer.then(o => conn.setLocalDescription(o));
    var remote = offer.then(j => handle.sendJsep(j)).then(r => conn.setRemoteDescription(r.jsep));
    Promise.all([local, remote]).catch(e => console.error("Error negotiating offer: ", e));
  });
  handle.on("event", ev => {
    if (ev.jsep && ev.jsep.type == "offer") {
      console.info("Accepting new offer for handle: ", handle, debugmsg);
      var answer = conn.setRemoteDescription(ev.jsep).then(_ => conn.createAnswer());
      var local = answer.then(a => conn.setLocalDescription(a));
      var remote = answer.then(j => handle.sendJsep(j));
      Promise.all([local, remote]).catch(e => console.error("Error negotiating answer: ", e));
    } else {
      //console.log('other event');
      //console.log(ev);
    }
  });
}

//function broadcast_video(msg) {
 //}


function sendData(ctx, channel, msg) {
  let obj = {
    "message": msg,
    "timestamp": new Date(),
    "from": ctx.user_id
  }
  if (channel.readyState == 'open') {
    console.log('sending: ');
    console.log(obj);
    channel.send(JSON.stringify(obj));
  } else {
    console.log('error');
    console.log(channel.readyState);
  }
}

function handleIncomingVideo (msg) {
  console.log('incoming video packet', msg.srcElement.label , msg.data);


}

function newDataChannel ( id ) {
  const channel = janusconn.createDataChannel(id , DATACHAN_CONF );
  if (id.startsWith("video")) {
     channel.addEventListener("message", handleIncomingVideo);
  } else {
    channel.addEventListener("message", storeUnreliableMessage);
  }
  //channel.addEventListener("onopen", sendData(channel, "chan is now open" + id));
//  setInterval(sendData, 1000,ctx, channel, "every second a messae on " + id);
  return channel
}

function showStatus (msg) {
  console.log(msg);
}

async function attachPublisher(ctx) {
  console.info("Attaching publisher for session: ", ctx.session);
 
  console.log('room: ', ctx.roomId, 'ctx: ', ctx);

  janusconn = new RTCPeerConnection(PEER_CONNECTION_CONFIG);
  var handle = new Minijanus.JanusPluginHandle(ctx.session);
  associate(janusconn, handle, "attach publisher");
  
  // Handle all of the join and leave events.
  handle.on("event", ev => {
    var data = ev.plugindata.data;
    if (data.event == "join" && data.room_id == ctx.roomId) {
      this.addUser(ctx, data.user_id);
    } else if (data.event == "leave" && data.room_id == ctx.roomId) {
      this.removeUser(ctx, data.user_id);
    } else if (data.event == "data") {
      console.log(data);
    }
  });

  await handle.attach("janus.plugin.sfu")
  showStatus(`Connecting WebRTC...`);
  
  // this is the channel we gonna publish video on
  ctx.videoChannel = newDataChannel("video" + ctx.user_id);

  await waitForEvent("webrtcup", handle);
  showStatus(`Joining room ${ctx.roomId}...`);

  console.log("user: ", ctx.user_id, "room: ", ctx.roomId);
 
  //try {
    const msg ={
      kind: "join",
      room_id: ctx.roomId,
      user_id: ctx.user_id,
      subscribe: { notifications: true, data: true }
    }
    console.log(msg);
    const reply = await handle.sendMessage(msg);
  // } catch(err) {
  //  console.log("err in reply: ", err); 
  //}


  showStatus(`Subscribing to others in room ${ctx.roomId}`);
  var occupants = reply.plugindata.data.response.users[ctx.roomId] || [];
  await Promise.all(occupants.map(userId => addUser(ctx, userId)));

  // returns handle + rtcpeerconn + videoChannel to send on
  return  { handle, janusconn, videoChannel};
}

function attachSubscriber(ctx, otherId) {
  console.info("Attaching subscriber to " + otherId + " for session: ", ctx.session);
  var conn = new RTCPeerConnection(PEER_CONNECTION_CONFIG);
  var handle = new Minijanus.JanusPluginHandle(ctx.session);
  addExisting(conn, handle, "attach subscriber: " + otherId);

  // this is 1 of the channels to receive video on 
  const otherVideoChannel = newDataChannel("video" + otherId);

  return handle.attach("janus.plugin.sfu")
    .then(_ => handle.sendMessage({ kind: "join", room_id: ctx.roomId, user_id: ctx.user_id, subscribe: { media: otherId }}))
    .then(_ => waitForEvent("webrtcup", handle))
    .then(_ => { return { handle: handle, conn: conn }; });
}

