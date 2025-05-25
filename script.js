
class WebRTCMessenger {
    constructor() {
        this.localConnection = null;
        this.dataChannel = null;
        this.ws = null;
        this.isHost = false;
        this.username = '';
        this.targetAddress = '';
        this.roomId = '';
        
        this.initializeElements();
        this.setupEventListeners();
        
        console.log('WebRTC Messenger initialized');
    }

    initializeElements() {
        this.statusEl = document.getElementById('status');
        this.usernameInput = document.getElementById('username');
        this.addressInput = document.getElementById('address');
        this.hostBtn = document.getElementById('host-btn');
        this.joinBtn = document.getElementById('join-btn');
        this.disconnectBtn = document.getElementById('disconnect-btn');
        this.messagesEl = document.getElementById('messages');
        this.messageInput = document.getElementById('message-input');
        this.sendBtn = document.getElementById('send-btn');
        this.localInfoEl = document.getElementById('local-info');
        this.remoteInfoEl = document.getElementById('remote-info');
    }

    setupEventListeners() {
        this.hostBtn.addEventListener('click', () => this.startHost());
        this.joinBtn.addEventListener('click', () => this.startJoin());
        this.disconnectBtn.addEventListener('click', () => this.disconnect());
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });
    }

    validateInputs() {
        this.username = this.usernameInput.value.trim();
        this.targetAddress = this.addressInput.value.trim();

        if (!this.username) {
            this.addSystemMessage('Please enter your name');
            return false;
        }

        if (!this.targetAddress) {
            this.addSystemMessage('Please enter IP:Port');
            return false;
        }

        const addressRegex = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{1,5})$/;
        if (!addressRegex.test(this.targetAddress)) {
            this.addSystemMessage('Please enter valid IP:Port format (e.g., 127.0.0.1:8080)');
            return false;
        }

        return true;
    }

    async startHost() {
        if (!this.validateInputs()) return;
        
        this.isHost = true;
        this.roomId = this.targetAddress;
        this.addSystemMessage(`Hosting on ${this.targetAddress}...`);
        await this.connectToSignaling();
    }

    async startJoin() {
        if (!this.validateInputs()) return;
        
        this.isHost = false;
        this.roomId = this.targetAddress;
        this.addSystemMessage(`Joining ${this.targetAddress}...`);
        await this.connectToSignaling();
    }

    async connectToSignaling() {
        this.updateStatus('connecting');
        this.toggleButtons(true);

        try {
            // Using a public WebSocket signaling server
            this.ws = new WebSocket('https://webrtc-backend-wd3d.onrender.com');
            
            this.ws.onopen = () => {
                console.log('Connected to signaling server');
                this.addSystemMessage('Connected to signaling server');
                
                // Join room
                this.sendSignal({
                    type: 'join',
                    room: this.roomId,
                    username: this.username,
                    isHost: this.isHost
                });
                
                this.setupPeerConnection();
            };

            this.ws.onmessage = async (event) => {
                try {
                    const message = JSON.parse(event.data);
                    await this.handleSignalingMessage(message);
                } catch (error) {
                    console.error('Error handling signaling message:', error);
                }
            };

            this.ws.onclose = () => {
                console.log('Signaling server disconnected');
                this.addSystemMessage('Signaling server disconnected');
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.addSystemMessage('Failed to connect to signaling server');
                this.updateStatus('disconnected');
                this.toggleButtons(false);
            };

        } catch (error) {
            console.error('Connection error:', error);
            this.addSystemMessage('Connection failed: ' + error.message);
            this.updateStatus('disconnected');
            this.toggleButtons(false);
        }
    }

    setupPeerConnection() {
        this.localConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        });

        this.localConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignal({
                    type: 'ice-candidate',
                    candidate: event.candidate,
                    room: this.roomId
                });
            }
        };

        this.localConnection.onconnectionstatechange = () => {
            const state = this.localConnection.connectionState;
            console.log('Connection state:', state);
            
            if (state === 'connected') {
                this.updateStatus('connected');
                this.addSystemMessage('P2P connection established!');
                this.updateConnectionInfo();
            } else if (state === 'disconnected' || state === 'failed') {
                this.addSystemMessage('P2P connection lost');
                this.disconnect();
            }
        };

        this.localConnection.ondatachannel = (event) => {
            this.dataChannel = event.channel;
            this.setupDataChannel();
        };

        if (this.isHost) {
            this.dataChannel = this.localConnection.createDataChannel('chat');
            this.setupDataChannel();
        }
    }

    setupDataChannel() {
        if (!this.dataChannel) return;

        this.dataChannel.onopen = () => {
            console.log('Data channel opened');
            this.addSystemMessage('Ready to send messages!');
            this.messageInput.disabled = false;
            this.sendBtn.disabled = false;
        };

        this.dataChannel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.addMessage(data.sender, data.content, false);
            } catch (error) {
                this.addMessage('Remote', event.data, false);
            }
        };

        this.dataChannel.onclose = () => {
            console.log('Data channel closed');
            this.addSystemMessage('Message channel closed');
            this.messageInput.disabled = true;
            this.sendBtn.disabled = true;
        };
    }

    async handleSignalingMessage(message) {
        console.log('Received signaling message:', message);

        switch (message.type) {
            case 'user-joined':
                if (this.isHost && !message.isHost) {
                    this.addSystemMessage('Client joined, creating offer...');
                    await this.createOffer();
                }
                break;

            case 'offer':
                if (!this.isHost) {
                    await this.handleOffer(message.offer);
                }
                break;

            case 'answer':
                if (this.isHost) {
                    await this.handleAnswer(message.answer);
                }
                break;

            case 'ice-candidate':
                await this.handleIceCandidate(message.candidate);
                break;
        }
    }

    async createOffer() {
        try {
            const offer = await this.localConnection.createOffer();
            await this.localConnection.setLocalDescription(offer);
            
            this.sendSignal({
                type: 'offer',
                offer: offer,
                room: this.roomId
            });
        } catch (error) {
            console.error('Error creating offer:', error);
        }
    }

    async handleOffer(offer) {
        try {
            await this.localConnection.setRemoteDescription(offer);
            const answer = await this.localConnection.createAnswer();
            await this.localConnection.setLocalDescription(answer);
            
            this.sendSignal({
                type: 'answer',
                answer: answer,
                room: this.roomId
            });
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    }

    async handleAnswer(answer) {
        try {
            await this.localConnection.setRemoteDescription(answer);
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }

    async handleIceCandidate(candidate) {
        try {
            await this.localConnection.addIceCandidate(candidate);
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    }

    sendSignal(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    sendMessage() {
        const content = this.messageInput.value.trim();
        if (!content || !this.dataChannel || this.dataChannel.readyState !== 'open') {
            return;
        }

        const message = {
            sender: this.username,
            content: content,
            timestamp: new Date().toISOString()
        };

        try {
            this.dataChannel.send(JSON.stringify(message));
            this.addMessage(this.username, content, true);
            this.messageInput.value = '';
        } catch (error) {
            console.error('Error sending message:', error);
            this.addSystemMessage('Failed to send message');
        }
    }

    addMessage(sender, content, isSent) {
        const messageEl = document.createElement('div');
        messageEl.className = `message ${isSent ? 'sent' : 'received'}`;
        
        const senderEl = document.createElement('div');
        senderEl.className = 'message-sender';
        senderEl.textContent = sender;
        
        const contentEl = document.createElement('div');
        contentEl.className = 'message-content';
        contentEl.textContent = content;
        
        const timeEl = document.createElement('div');
        timeEl.className = 'message-time';
        timeEl.textContent = new Date().toLocaleTimeString();
        
        messageEl.appendChild(senderEl);
        messageEl.appendChild(contentEl);
        messageEl.appendChild(timeEl);
        
        this.messagesEl.appendChild(messageEl);
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    addSystemMessage(text) {
        const messageEl = document.createElement('div');
        messageEl.className = 'message system-message';
        messageEl.innerHTML = `<div class="message-content">${text}</div>`;
        this.messagesEl.appendChild(messageEl);
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    updateStatus(status) {
        this.statusEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        this.statusEl.className = `status ${status}`;
    }

    updateConnectionInfo() {
        this.localInfoEl.textContent = this.targetAddress;
        this.remoteInfoEl.textContent = 'Connected via WebRTC';
    }

    toggleButtons(connecting) {
        this.hostBtn.disabled = connecting;
        this.joinBtn.disabled = connecting;
        this.disconnectBtn.disabled = !connecting;
        this.usernameInput.disabled = connecting;
        this.addressInput.disabled = connecting;
    }

    disconnect() {
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }

        if (this.localConnection) {
            this.localConnection.close();
            this.localConnection = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.updateStatus('disconnected');
        this.toggleButtons(false);
        this.messageInput.disabled = true;
        this.sendBtn.disabled = true;
        this.localInfoEl.textContent = 'Not connected';
        this.remoteInfoEl.textContent = 'Not connected';
        this.addSystemMessage('Disconnected');
    }
}

// Initialize the messenger when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new WebRTCMessenger();
});
