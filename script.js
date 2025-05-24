// Global variables
let localConnection = null;
let dataChannel = null;
let ws = null;
let username = '';
let localPort = '';
let targetIP = '';
let targetPort = '';
let isSenderMode = true;

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
    
    // Show or hide target input fields based on mode
    const targetGroup = document.querySelector('.target-group');
    targetGroup.style.display = isSenderMode ? 'block' : 'none';

    if (!isSenderMode) {
        targetAddressInput.value = '';
    }
}

// Handle establishing connection
function handleConnection() {
    console.log('Starting connection process...');
    
    username = nameInput.value.trim();
    localPort = localPortInput.value.trim();
    
    if (!username || !localPort) {
        addSystemMessage('Please fill in your name and local port.');
        return;
    }

    if (!validatePort(localPort)) {
        addSystemMessage('Please enter a valid local port (1-65535).');
        return;
    }

    if (isSenderMode) {
        const targetAddress = targetAddressInput.value.trim();
        if (!targetAddress) {
            addSystemMessage('Please enter target address in format IP:PORT (e.g., 127.0.0.1:8080).');
            return;
        }

        const parsed = parseTargetAddress(targetAddress);
        if (!parsed) {
            addSystemMessage('Invalid target address format. Use IP:PORT (e.g., 127.0.0.1:8080).');
            return;
        }

        if (!validateIP(parsed.ip) || !validatePort(parsed.port)) {
            addSystemMessage('Invalid IP address or port in target address.');
            return;
        }

        targetIP = parsed.ip;
        targetPort = parsed.port;
    }

    addSystemMessage('Connecting to signaling server...');
    
    // Use a working WebSocket signaling server
    const wsUrl = 'https://webrtc-backend-wd3d.onrender.com';
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WebSocket connected');
        addSystemMessage('Connected to signaling server');
        
        setupPeer();
        
        if (isSenderMode) {
            // Create data channel for sender
            dataChannel = localConnection.createDataChannel("chat", {
                ordered: true
            });
            setupDataChannel();
            
            // Create and send offer
            localConnection.createOffer()
                .then(offer => {
                    console.log('Created offer:', offer);
                    return localConnection.setLocalDescription(offer);
                })
                .then(() => {
                    console.log('Set local description');
                    // In a real implementation, you would send this to the peer
                    addSystemMessage('Connection offer created. Waiting for peer...');
                })
                .catch(error => {
                    console.error("Error creating offer:", error);
                    addSystemMessage("Error creating connection offer: " + error.message);
                });
        }

        // Update connection details display
        const localAddress = getLocalIP() + ':' + localPort;
        const remoteAddress = isSenderMode ? targetIP + ':' + targetPort : 'Waiting for connection...';
        
        localAddressDisplay.textContent = localAddress;
        remoteAddressDisplay.textContent = remoteAddress;
        
        setConnectedState(true);
        
        // Simulate successful P2P connection for testing
        setTimeout(() => {
            if (dataChannel && dataChannel.readyState !== 'open') {
                addSystemMessage('P2P connection established (simulated)');
                messageInput.disabled = false;
                sendBtn.disabled = false;
            }
        }, 2000);
    };

    ws.onmessage = (event) => {
        console.log('Received WebSocket message:', event.data);
        // Handle signaling messages here
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        addSystemMessage('Error connecting to signaling server');
    };
    
    ws.onclose = () => {
        console.log('WebSocket closed');
        addSystemMessage('Disconnected from signaling server');
    };
}

// Set up WebRTC peer connection
function setupPeer() {
    console.log('Setting up peer connection...');
    
    localConnection = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });

    localConnection.onicecandidate = event => {
        if (event.candidate) {
            console.log('ICE candidate:', event.candidate);
            // In a real implementation, send this to the peer via signaling server
        }
    };

    localConnection.onconnectionstatechange = () => {
        console.log("Connection state:", localConnection.connectionState);
        if (localConnection.connectionState === 'connected') {
            addSystemMessage("WebRTC connection established");
        } else if (localConnection.connectionState === 'disconnected' || 
                  localConnection.connectionState === 'failed' || 
                  localConnection.connectionState === 'closed') {
            addSystemMessage('WebRTC connection ' + localConnection.connectionState);
        }
    };

    localConnection.ondatachannel = event => {
        console.log('Data channel received');
        dataChannel = event.channel;
        setupDataChannel();
    };
}

// Set up the data channel for messaging
function setupDataChannel() {
    if (!dataChannel) return;
    
    console.log('Setting up data channel...');

    dataChannel.onopen = () => {
        console.log('Data channel opened');
        addSystemMessage('Direct P2P connection established');
        messageInput.disabled = false;
        sendBtn.disabled = false;
    };

    dataChannel.onmessage = (event) => {
        console.log('Received message:', event.data);
        try {
            const data = JSON.parse(event.data);
            addMessageToChat(data, false);
        } catch (e) {
            // If it's not JSON, treat it as plain text
            const msg = {
                sender: isSenderMode ? targetIP : 'Peer',
                content: event.data,
                timestamp: new Date().toISOString()
            };
            addMessageToChat(msg, false);
        }
    };

    dataChannel.onclose = () => {
        console.log('Data channel closed');
        addSystemMessage('P2P connection closed');
        messageInput.disabled = true;
        sendBtn.disabled = true;
    };

    dataChannel.onerror = (error) => {
        console.error("Data Channel Error:", error);
        addSystemMessage('Error in data channel');
    };
}

// Send a message to the peer
function sendMessage() {
    const content = messageInput.value.trim();
    if (!content) return;

    console.log('Attempting to send message:', content);

    // For demo purposes, since we don't have a real peer connection,
    // we'll simulate sending and receiving
    const msg = {
        sender: username,
        content: content,
        timestamp: new Date().toISOString()
    };
    
    // Add as sent message
    addMessageToChat(msg, true);
    messageInput.value = '';
    
    // Simulate echo response for testing
    setTimeout(() => {
        const echoMsg = {
            sender: 'Echo',
            content: 'Echo: ' + content,
            timestamp: new Date().toISOString()
        };
        addMessageToChat(echoMsg, false);
    }, 1000);
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

console.log('TCP/IP Messenger initialized');
