// Global variables
let localConnection = null;
let remoteConnection = null;
let dataChannel = null;
let ws = null;
let username = '';
let localPort = '';
let targetIP = '';
let targetPort = '';
let isSenderMode = true;
let isConnecting = false;

// DOM elements
const statusBadge = document.querySelector('.status-badge');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const toggleModeBtn = document.getElementById('toggle-mode-btn');
const nameInput = document.getElementById('name');
const localPortInput = document.getElementById('local-port');
const targetAddressInput = document.getElementById('target-address');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const messagesContainer = document.getElementById('messages');
const modeDisplay = document.getElementById('mode-display');
const localAddressDisplay = document.getElementById('local-address');
const remoteAddressDisplay = document.getElementById('remote-address');

// Event listeners
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

// Parse target address in IP:PORT format
function parseTargetAddress(address) {
    const parts = address.split(':');
    if (parts.length === 2) {
        return {
            ip: parts[0].trim(),
            port: parts[1].trim()
        };
    }
    return null;
}

// Validate IP address
function validateIP(ip) {
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return ipRegex.test(ip) || ip === 'localhost' || ip === '127.0.0.1';
}

// Validate port
function validatePort(port) {
    const portNum = parseInt(port);
    return !isNaN(portNum) && portNum > 0 && portNum <= 65535;
}

// Toggle between sender and receiver mode
function toggleMode() {
    handleDisconnection();
    isSenderMode = !isSenderMode;
    updateUIForMode();
}

// Update UI based on the current mode
function updateUIForMode() {
    modeDisplay.textContent = isSenderMode ? 'Sender' : 'Receiver';
    toggleModeBtn.textContent = isSenderMode ? 'Switch to Receiver Mode' : 'Switch to Sender Mode';
    
    const targetGroup = document.querySelector('.target-group');
    targetGroup.style.display = isSenderMode ? 'block' : 'none';

    if (!isSenderMode) {
        targetAddressInput.value = '';
    }
}

// Handle establishing connection
function handleConnection() {
    if (isConnecting) return;
    
    console.log('Starting connection process...');
    isConnecting = true;
    
    username = nameInput.value.trim();
    localPort = localPortInput.value.trim();
    
    if (!username || !localPort) {
        addSystemMessage('Please fill in your name and local port.');
        isConnecting = false;
        return;
    }

    if (!validatePort(localPort)) {
        addSystemMessage('Please enter a valid local port (1-65535).');
        isConnecting = false;
        return;
    }

    if (isSenderMode) {
        const targetAddress = targetAddressInput.value.trim();
        if (!targetAddress) {
            addSystemMessage('Please enter target address in format IP:PORT (e.g., 127.0.0.1:8080).');
            isConnecting = false;
            return;
        }

        const parsed = parseTargetAddress(targetAddress);
        if (!parsed) {
            addSystemMessage('Invalid target address format. Use IP:PORT (e.g., 127.0.0.1:8080).');
            isConnecting = false;
            return;
        }

        if (!validateIP(parsed.ip) || !validatePort(parsed.port)) {
            addSystemMessage('Invalid IP address or port in target address.');
            isConnecting = false;
            return;
        }

        targetIP = parsed.ip;
        targetPort = parsed.port;
    }

    addSystemMessage('Connecting to signaling server...');
    
    // Connect to a real signaling server
    const wsUrl = 'https://webrtc-backend-wd3d.onrender.com';
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WebSocket connected to signaling server');
        addSystemMessage('Connected to signaling server');
        
        // Send join message with room ID based on target
        const roomId = isSenderMode ? `${targetIP}:${targetPort}` : `${getLocalIP()}:${localPort}`;
        const joinMessage = {
            type: 'join',
            room: roomId,
            username: username,
            mode: isSenderMode ? 'sender' : 'receiver'
        };
        
        ws.send(JSON.stringify(joinMessage));
        
        setupPeerConnection();
        
        // Update connection details display
        const localAddress = getLocalIP() + ':' + localPort;
        const remoteAddress = isSenderMode ? targetIP + ':' + targetPort : 'Waiting for connection...';
        
        localAddressDisplay.textContent = localAddress;
        remoteAddressDisplay.textContent = remoteAddress;
        
        setConnectedState(true);
        isConnecting = false;
    };

    ws.onmessage = async (event) => {
        console.log('Received signaling message:', event.data);
        try {
            const message = JSON.parse(event.data);
            await handleSignalingMessage(message);
        } catch (error) {
            console.error('Error handling signaling message:', error);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        addSystemMessage('Error connecting to signaling server');
        isConnecting = false;
    };
    
    ws.onclose = () => {
        console.log('WebSocket closed');
        addSystemMessage('Disconnected from signaling server');
        isConnecting = false;
    };
}

// Handle signaling messages
async function handleSignalingMessage(message) {
    console.log('Handling message:', message);
    
    switch (message.type) {
        case 'offer':
            if (!isSenderMode) {
                await handleOffer(message);
            }
            break;
        case 'answer':
            if (isSenderMode) {
                await handleAnswer(message);
            }
            break;
        case 'ice-candidate':
            await handleIceCandidate(message);
            break;
        case 'user-joined':
            if (isSenderMode && message.mode === 'receiver') {
                addSystemMessage('Receiver found, initiating connection...');
                await createOffer();
            }
            break;
    }
}

// Set up WebRTC peer connection
function setupPeerConnection() {
    console.log('Setting up peer connection...');
    
    localConnection = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ]
    });

    localConnection.onicecandidate = event => {
        if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
            console.log('Sending ICE candidate');
            ws.send(JSON.stringify({
                type: 'ice-candidate',
                candidate: event.candidate
            }));
        }
    };

    localConnection.onconnectionstatechange = () => {
        console.log("Connection state:", localConnection.connectionState);
        if (localConnection.connectionState === 'connected') {
            addSystemMessage("P2P connection established successfully!");
        } else if (localConnection.connectionState === 'disconnected' || 
                  localConnection.connectionState === 'failed' || 
                  localConnection.connectionState === 'closed') {
            addSystemMessage('P2P connection ' + localConnection.connectionState);
            if (localConnection.connectionState === 'failed') {
                handleDisconnection();
            }
        }
    };

    localConnection.ondatachannel = event => {
        console.log('Data channel received');
        dataChannel = event.channel;
        setupDataChannel();
    };

    // If sender, create data channel
    if (isSenderMode) {
        dataChannel = localConnection.createDataChannel("chat", {
            ordered: true
        });
        setupDataChannel();
    }
}

// Create offer (sender)
async function createOffer() {
    try {
        const offer = await localConnection.createOffer();
        await localConnection.setLocalDescription(offer);
        
        console.log('Sending offer');
        ws.send(JSON.stringify({
            type: 'offer',
            offer: offer
        }));
    } catch (error) {
        console.error("Error creating offer:", error);
        addSystemMessage("Error creating connection offer");
    }
}

// Handle offer (receiver)
async function handleOffer(message) {
    try {
        await localConnection.setRemoteDescription(message.offer);
        const answer = await localConnection.createAnswer();
        await localConnection.setLocalDescription(answer);
        
        console.log('Sending answer');
        ws.send(JSON.stringify({
            type: 'answer',
            answer: answer
        }));
    } catch (error) {
        console.error("Error handling offer:", error);
        addSystemMessage("Error handling connection offer");
    }
}

// Handle answer (sender)
async function handleAnswer(message) {
    try {
        await localConnection.setRemoteDescription(message.answer);
        console.log('Answer received and set');
    } catch (error) {
        console.error("Error handling answer:", error);
        addSystemMessage("Error handling connection answer");
    }
}

// Handle ICE candidate
async function handleIceCandidate(message) {
    try {
        await localConnection.addIceCandidate(message.candidate);
        console.log('ICE candidate added');
    } catch (error) {
        console.error("Error adding ICE candidate:", error);
    }
}

// Set up the data channel for messaging
function setupDataChannel() {
    if (!dataChannel) return;
    
    console.log('Setting up data channel...');

    dataChannel.onopen = () => {
        console.log('Data channel opened');
        addSystemMessage('Ready to send messages!');
        messageInput.disabled = false;
        sendBtn.disabled = false;
    };

    dataChannel.onmessage = (event) => {
        console.log('Received message:', event.data);
        try {
            const data = JSON.parse(event.data);
            addMessageToChat(data, false);
        } catch (e) {
            const msg = {
                sender: 'Remote',
                content: event.data,
                timestamp: new Date().toISOString()
            };
            addMessageToChat(msg, false);
        }
    };

    dataChannel.onclose = () => {
        console.log('Data channel closed');
        addSystemMessage('Message channel closed');
        messageInput.disabled = true;
        sendBtn.disabled = true;
    };

    dataChannel.onerror = (error) => {
        console.error("Data Channel Error:", error);
        addSystemMessage('Error in message channel');
    };
}

// Send a message to the peer
function sendMessage() {
    const content = messageInput.value.trim();
    if (!content || !dataChannel || dataChannel.readyState !== 'open') {
        if (!dataChannel || dataChannel.readyState !== 'open') {
            addSystemMessage('Not connected to peer. Please establish connection first.');
        }
        return;
    }

    console.log('Sending message:', content);

    const msg = {
        sender: username,
        content: content,
        timestamp: new Date().toISOString()
    };
    
    try {
        dataChannel.send(JSON.stringify(msg));
        addMessageToChat(msg, true);
        messageInput.value = '';
    } catch (error) {
        console.error('Error sending message:', error);
        addSystemMessage('Error sending message: ' + error.message);
    }
}

// Add a message to the chat UI
function addMessageToChat(messageData, isSent) {
    const msg = document.createElement('div');
    msg.className = 'message ' + (isSent ? 'sent' : 'received');

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

// Add a system message to the chat
function addSystemMessage(text) {
    console.log('System message:', text);
    const el = document.createElement('div');
    el.className = 'system-message';
    el.textContent = text;
    messagesContainer.appendChild(el);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Update UI elements based on connection state
function setConnectedState(connected) {
    statusBadge.className = 'status-badge ' + (connected ? 'connected' : 'disconnected');
    statusBadge.textContent = connected ? 'Connected' : 'Disconnected';
    connectBtn.disabled = connected;
    disconnectBtn.disabled = !connected;
}

// Handle disconnection
function handleDisconnection() {
    console.log('Disconnecting...');
    
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
    
    messageInput.disabled = true;
    sendBtn.disabled = true;
    isConnecting = false;
}

// Clear connection details in UI
function clearConnectionDetails() {
    localAddressDisplay.textContent = 'Not connected';
    remoteAddressDisplay.textContent = 'Not connected';
}

// Helper function to get local IP (simplified version)
function getLocalIP() {
    return "127.0.0.1";
}

// Initialize UI based on current mode
updateUIForMode();

console.log('TCP/IP Messenger initialized with real WebRTC');
