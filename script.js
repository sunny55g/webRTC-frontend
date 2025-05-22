let localConnection = null;
let dataChannel = null;
let ws = null;
let username = '';
let target = '';
let isSenderMode = true;

const statusBadge = document.querySelector('.status-badge');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const toggleModeBtn = document.getElementById('toggle-mode-btn');
const nameInput = document.getElementById('name');
const targetInput = document.getElementById('target');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const messagesContainer = document.getElementById('messages');
const modeDisplay = document.getElementById('mode-display');
const localAddressDisplay = document.getElementById('local-address');
const remoteAddressDisplay = document.getElementById('remote-address');

connectBtn.addEventListener('click', handleConnection);
disconnectBtn.addEventListener('click', handleDisconnection);
toggleModeBtn.addEventListener('click', toggleMode);
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

function toggleMode() {
    handleDisconnection();
    isSenderMode = !isSenderMode;
    updateUIForMode();
}

function updateUIForMode() {
    modeDisplay.textContent = isSenderMode ? 'Sender' : 'Receiver';
    toggleModeBtn.textContent = isSenderMode ? 'Switch to Receiver Mode' : 'Switch to Sender Mode';
    targetInput.disabled = !isSenderMode;
    targetInput.value = '';
    targetInput.placeholder = isSenderMode ? 'Enter target IP or address' : 'Enter your name only';
}

function handleConnection() {
    username = nameInput.value.trim();
    target = targetInput.value.trim();

    if (!username || (isSenderMode && !target)) {
        addSystemMessage('Please fill in all fields.');
        return;
    }

    ws = new WebSocket('wss://webrtc-backend-wd3d.onrender.com');

    ws.onopen = () => {
        ws.send(JSON.stringify({
            type: 'init',
            name: username,
            target: target
        }));

        setupPeer();
        if (isSenderMode) {
            dataChannel = localConnection.createDataChannel("chat");
            setupDataChannel();
            localConnection.createOffer()
                .then(offer => localConnection.setLocalDescription(offer))
                .then(() => {
                    sendSignal({ sdp: localConnection.localDescription });
                });
        }

        localAddressDisplay.textContent = 'You';
        remoteAddressDisplay.textContent = isSenderMode ? target : 'Waiting...';
        setConnectedState(true);
    };

    ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'signal' && msg.data) {
            if (msg.data.sdp) {
                await localConnection.setRemoteDescription(new RTCSessionDescription(msg.data.sdp));
                if (msg.data.sdp.type === 'offer') {
                    localConnection.createAnswer()
                        .then(answer => localConnection.setLocalDescription(answer))
                        .then(() => {
                            sendSignal({ sdp: localConnection.localDescription });
                        });
                }
            } else if (msg.data.candidate) {
                try {
                    await localConnection.addIceCandidate(new RTCIceCandidate(msg.data));
                } catch (e) {
                    console.error('Error adding received ice candidate', e);
                }
            }
        }
    };

    ws.onerror = err => console.error('WebSocket error:', err);
    ws.onclose = () => addSystemMessage('Disconnected from signaling server');
}

function setupPeer() {
    localConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    localConnection.onicecandidate = event => {
        if (event.candidate) {
            sendSignal(event.candidate);
        }
    };

    localConnection.ondatachannel = event => {
        dataChannel = event.channel;
        setupDataChannel();
    };
}

function sendSignal(data) {
    ws.send(JSON.stringify({
        type: 'signal',
        name: username,
        target: target,
        data: data
    }));
}

function setupDataChannel() {
    dataChannel.onopen = () => {
        addSystemMessage('P2P connection established');
        messageInput.disabled = false;
        sendBtn.disabled = false;
    };

    dataChannel.onmessage = (event) => {
        const msg = {
            sender: target,
            content: event.data,
            timestamp: new Date().toISOString()
        };
        addMessageToChat(msg, false);
    };

    dataChannel.onclose = () => {
        addSystemMessage('P2P connection closed');
        messageInput.disabled = true;
        sendBtn.disabled = true;
    };
}

function sendMessage() {
    const content = messageInput.value.trim();
    if (content && dataChannel && dataChannel.readyState === 'open') {
        const msg = {
            sender: username,
            content: content,
            timestamp: new Date().toISOString()
        };
        dataChannel.send(content);
        addMessageToChat(msg, true);
        messageInput.value = '';
    }
}

function addMessageToChat(messageData, isSent) {
    const msg = document.createElement('div');
    msg.className = `message ${isSent ? 'sent' : 'received'}`;

    const sender = document.createElement('div');
    sender.className = 'sender';
    sender.textContent = messageData.sender;

    const content = document.createElement('div');
    content.className = 'content';
    content.textContent = messageData.content;

    const timestamp = document.createElement('div');
    timestamp.className = 'timestamp';
    timestamp.textContent = new Date(messageData.timestamp).toLocaleTimeString();

    msg.appendChild(sender);
    msg.appendChild(content);
    msg.appendChild(timestamp);
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function addSystemMessage(text) {
    const el = document.createElement('div');
    el.className = 'system-message';
    el.innerHTML = text;
    messagesContainer.appendChild(el);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function setConnectedState(connected) {
    statusBadge.className = 'status-badge ' + (connected ? 'connected' : 'disconnected');
    statusBadge.textContent = connected ? 'Connected' : 'Disconnected';
    connectBtn.disabled = connected;
    disconnectBtn.disabled = !connected;
    messageInput.disabled = !connected;
    sendBtn.disabled = !connected;
}

function handleDisconnection() {
    if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
    }
    if (localConnection) {
        localConnection.close();
        localConnection = null;
    }
    if (ws) {
        ws.close();
        ws = null;
    }
    setConnectedState(false);
    addSystemMessage('Disconnected');
    clearConnectionDetails();
}

function clearConnectionDetails() {
    localAddressDisplay.textContent = 'Not connected';
    remoteAddressDisplay.textContent = 'Not connected';
}

updateUIForMode();
