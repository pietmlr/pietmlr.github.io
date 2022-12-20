function makeid(length) {
    var result = '';
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for ( var i = 0; i < length; i++ ) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

// Global variables
var localUsername = null;
var targetUsername = null;

var host = 'wss://81.169.235.122';

// getUserMedia() is only available in a 'file:///' or tls secured url, so 'https://'
const mediaConstraints = {
    audio: true,
    video: true
}

var peerConnection = null;
var connection = null;


function connect() {
    connection = new WebSocket(host);

    connection.onopen = function(event) {
        // Log into the signaling server
        console.log('send login from: ' + localUsername);
        connection.send(JSON.stringify({
            type: 'login',
            username: localUsername
        }));
    };

    // receives initial message => {'type':'connected to signaling server'}
    // keep listening asychronously to all other tasks
    connection.onmessage = function(event) {
        var msg = JSON.parse(event.data);
        console.log('Message received:', msg);

        switch (msg.type) {
            case 'login':
                if (msg.success) {
                    console.log('Successfully logged into the singaling server.', msg.success);
                } else { console.log('Could not connect to the signaling server.', msg.success); }
                break;

            // Invitation and offer to establish peer connection
            case 'sdp-offer':
                handleSDPOfferMsg(msg);
                break;

            // Callee has answered offer from this peer
            case 'sdp-answer':
                handleSDPAnswerMsg(msg);
                break;

            case 'users-update':
                handleUserListMsg(msg);
                break;

            case 'new-ice-candidate':
                handleNewICECandidateMsg(msg);
                break;

            case 'leave':
                console.log(msg.message);
                break;
        }
    };

    connection.onclose = function(event) {
        connection.send(JSON.stringify({
            type: 'leave',
            username: localUsername
        }));
        console.log('You disconnected from signaling');
    }
}

// Get username from prompt, if username is entered, connect to the signaling server
document.getElementById('usernameBtn').onclick = function() {
    localUsername = document.getElementById('localUsername').value;
    if (localUsername !== '' && localUsername !== ' ') {
        connect(); 
    } else {
        alert('Username cannot be empty');
    }
};

// Sending data to the signaling server
function sendToServer(data) {
    console.log('Sending', data, 'to signaling server');
    connection.send(JSON.stringify(data));
}

// Retrieve a peer connection
// (= createPeerConnection(), except not sending sdp-offers to other peer)
function retrievePeerConnection() {
    peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.stunprotocol.org' }]
    });

    peerConnection.onnegotiationneeded = handleNegotiationNeededEvent;
    peerConnection.ontrack = handleTrackEvent;
    peerConnection.onicecandidate = handleICECandidateEvent;
    peerConnection.onsignalingstatechange = (event) => {
        console.log('Current signaling state: ' + peerConnection.signalingState);
    };
}

// Configure the peer connection
function createPeerConnection() {
    peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.stunprotocol.org' }]
    });

    // Most important event occurances during the peer connection
    peerConnection.onnegotiationneeded = handleNegotiationNeededEvent;
    peerConnection.ontrack = handleTrackEvent;
    peerConnection.onicecandidate = handleICECandidateEvent;
    peerConnection.onsignalingstatechange = (event) => {
        console.log('Current signaling state: ' + peerConnection.signalingState);
    };
}

// Initilization of a peer to peer connection (invitation by one peer)
// (Other peer has just to be logged in in the signaling server, so available)
function invite(event) {
    console.log('Clicked invitation!');
    if (peerConnection) {
        alert('You cannot start a call because you already have one going!');
    } else {
        createPeerConnection();

        navigator.mediaDevices
        .getUserMedia(mediaConstraints) || navigator.webkitGetUserMedia(mediaConstraints) || navigator.mozGetUserMedia(mediaConstraints)
        .then((localCameraStream) => {
            // Display the local camera stream in a DOM element
            document.getElementById('local_video').srcObject = localCameraStream;
            // Add the local camera stream to the peer connection
            localCameraStream.getTracks().forEach((track) => {
                peerConnection.addTrack(track, localCameraStream);
            });
        });
    }
}

// Sending offer (handle negotiation needed event)
function handleNegotiationNeededEvent() {
    console.log('Negotiation needed!');
    peerConnection.createOffer()
    .then((sdp_offer) => peerConnection.setLocalDescription(sdp_offer))
    .then(() => {
        sendToServer({
            sender: localUsername,
            target: targetUsername,
            type: 'sdp-offer',
            offer: peerConnection.localDescription
        });
    }).catch(e => console.log(e, 'or not connected to singaling server'));
}

// Handling incoming SDP answers from other peer
async function handleSDPAnswerMsg(msg) {
    console.log('Received s sdp-answer!');
    const remoteDescription = new RTCSessionDescription(msg.answer);

    await peerConnection.setRemoteDescription(remoteDescription);
    if (peerConnection.signalingState == 'stable') {
        console.log('Peer-2-Peer-Connection is successfully established!');
    }
}

// Handles updates of the available users list from signling server
function handleUserListMsg(msg) {
    // If there are list element inside ul, delete them
    let userList = document.getElementById('userList');
    while (userList.firstChild) {
        userList.removeChild(userList.lastChild);
    };

    // Fill list up with updated user data
    msg.availableUsers.forEach((user) => {
        let listElement = document.createElement('li');
        // Do not display own name in available user list
        if (user === localUsername) { 
            user = 'yourself';
        } 
        listElement.innerText = user;
        userList.appendChild(listElement);
        if (user !== 'yourself') {
            let inviteButtonElement = document.createElement('button');
            // inviteButtonElement.innerText = 'Invite ' + user + ' to a P2P call';
            inviteButtonElement.innerText = user;
            inviteButtonElement.className = 'availablePeer';
            inviteButtonElement.onclick = function(event) {
                targetUsername = event.currentTarget.innerText;
                invite();
            };
            listElement.appendChild(inviteButtonElement);
        }
    });
}

// Receiving offer (no system eventhandler, so trigger with websocket)
async function handleSDPOfferMsg(msg) {
    console.log('Received a sdp-offer!');
    let localStream = null;

    targetUsername = msg.sender;

    // handle remote description
    const remoteDescription = new RTCSessionDescription(msg.offer);

    // Establish the peer connection on the other peer 
    // if not already connected
    if (!peerConnection) {
        createPeerConnection();
    }

    // should be in 'have-local-offer' signaling state now
    await peerConnection.setRemoteDescription(remoteDescription);

    await navigator.mediaDevices.getUserMedia(mediaConstraints) || navigator.webkitGetUserMedia(mediaConstraints) || navigator.mozGetUserMedia(mediaConstraints)
    .then((stream) => {
        localStream = stream;
        document.getElementById('local_video').srcObject = localStream;
        localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));
    });

    await peerConnection.setLocalDescription(await peerConnection.createAnswer());

    sendToServer({
        sender: localUsername,
        target: msg.sender,
        type: 'sdp-answer',
        answer: peerConnection.localDescription
    });
}

// Handling incoming streams (new tracks)
function handleTrackEvent(event) {
    console.log('handleTrackEvent() called');
    document.getElementById('received_video').srcObject = event.streams[0];
    document.getElementById('hangup-button').disabled = false;
}

// Handle generated ICE candidate by this peer and send it to other peer
function handleICECandidateEvent(event) {
    console.log('handleICECandidateEvent() called');
    if (event.candidate) {
        sendToServer({
            type: 'new-ice-candidate',
            target: targetUsername,
            sender: localUsername,
            candidate: event.candidate
        });
    }
}

// Handle incoming ICE candidates from other peer
function handleNewICECandidateMsg(msg) {
    console.log('Received ICE candidate:', msg);
    console.log(peerConnection, typeof peerConnection);
    const candidate = new RTCIceCandidate(msg.candidate);
    peerConnection.addIceCandidate(candidate);
    console.log('Added ICE candidate to peer connection');
}

function closeCall() {
    if (peerConnection) {
        console.log('Closing peer connection');

        // Disconnect all handlers to stop event triggers
        peerConnection.onnegotiationneeded = null;
        peerConnection.ontrack = null;
        peerConnection.onicecandidate = null;
        peerConnection.onsigSnalingstatechange = null;

        // Stop all transceivers on the peer connection
        peerConnection.getTransceivers().forEach(transceiver => {
            transceiver.stop();
        });

        // Stop webcam preview, pause video element
        // and then stop all tracks on the peer connection
        const localVideo = document.getElementById('local_video');
        if (localVideo.srcObject) {
            localVideo.pause();
            localVideo.srcObject.getTracks().forEach(track => {
                track.stop();
            });
        }

        // Close peer connection
        peerConnection.close();
        peerConnection = null;
    }

    document.getElementById('hangup-button').disabled = true;
    targetUsername = null;
}

function hangUpCall() {
    sendToServer({
        type: 'leave',
        sender: localUsername,
        target: targetUsername
    });

    closeCall();
}
