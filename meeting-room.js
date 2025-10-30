class VideoMeetingApp {
    constructor() {
        this.peer = null;
        this.localStream = null;
        this.peers = {};
        this.meetingId = null;
        this.isHost = false;
        this.userName = 'User';
        this.isMuted = false;
        this.isVideoOff = false;
        this.isScreenSharing = false;
        
        this.initializeElements();
        this.bindEvents();
        this.initializeMeeting();
    }
    
    initializeElements() {
        // Meeting room elements
        this.meetingRoom = document.getElementById('meetingRoom');
        this.localVideo = document.getElementById('localVideo');
        this.currentMeetingId = document.getElementById('currentMeetingId');
        this.videoContainer = document.getElementById('videoContainer');
        this.participantCount = document.getElementById('participantCount');
        this.sidebar = document.getElementById('sidebar');
        this.participantsPanel = document.getElementById('participantsPanel');
        this.chatPanel = document.getElementById('chatPanel');
        this.participantsList = document.getElementById('participantsList');
        this.chatMessages = document.getElementById('chatMessages');
        this.chatInput = document.getElementById('chatInput');
        
        // Control buttons
        this.micBtn = document.getElementById('micBtn');
        this.videoBtn = document.getElementById('videoBtn');
        this.screenShareBtn = document.getElementById('screenShareBtn');
        this.raiseHandBtn = document.getElementById('raiseHandBtn');
        this.reactionBtn = document.getElementById('reactionBtn');
        this.moreBtn = document.getElementById('moreBtn');
        this.leaveBtn = document.getElementById('leaveBtn');
        
        // Header buttons
        this.participantsBtn = document.getElementById('participantsBtn');
        this.chatBtn = document.getElementById('chatBtn');
        this.securityBtn = document.getElementById('securityBtn');
        this.recordBtn = document.getElementById('recordBtn');
        this.closeParticipants = document.getElementById('closeParticipants');
        this.closeChat = document.getElementById('closeChat');
        this.sendMessageBtn = document.getElementById('sendMessageBtn');
        
        // Other elements
        this.reactionPicker = document.getElementById('reactionPicker');
        this.toastContainer = document.getElementById('toastContainer');
    }
    
    bindEvents() {
        // Control bar events
        this.micBtn.addEventListener('click', () => this.toggleMic());
        this.videoBtn.addEventListener('click', () => this.toggleVideo());
        this.screenShareBtn.addEventListener('click', () => this.toggleScreenShare());
        this.raiseHandBtn.addEventListener('click', () => this.raiseHand());
        this.reactionBtn.addEventListener('click', () => this.toggleReactionPicker());
        this.leaveBtn.addEventListener('click', () => this.leaveMeeting());
        
        // Header events
        this.participantsBtn.addEventListener('click', () => this.showPanel('participants'));
        this.chatBtn.addEventListener('click', () => this.showPanel('chat'));
        this.closeParticipants.addEventListener('click', () => this.hideSidebar());
        this.closeChat.addEventListener('click', () => this.hideSidebar());
        
        // Chat events
        this.sendMessageBtn.addEventListener('click', () => this.sendMessage());
        this.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        
        // Reaction events
        document.querySelectorAll('.reaction-picker button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.sendReaction(e.target.dataset.reaction);
                this.toggleReactionPicker();
            });
        });
        
        // Click outside to close reaction picker
        document.addEventListener('click', (e) => {
            if (!this.reactionPicker.contains(e.target) && e.target !== this.reactionBtn) {
                this.reactionPicker.classList.add('hidden');
            }
        });
        
        // Get meeting ID from URL or generate new
        const urlParams = new URLSearchParams(window.location.search);
        this.meetingId = urlParams.get('meetingId') || this.generateMeetingId();
        this.isHost = !urlParams.has('meetingId');
        this.userName = urlParams.get('userName') || (this.isHost ? 'Host' : 'Participant');
    }
    
    async initializeMeeting() {
        try {
            // Get user media
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            
            // Set local video
            this.localVideo.srcObject = this.localStream;
            document.getElementById('localName').textContent = this.userName;
            
            // Initialize PeerJS
            this.peer = new Peer(this.isHost ? this.meetingId : undefined, {
                debug: 2
            });
            
            this.peer.on('open', (id) => {
                if (this.isHost) {
                    this.currentMeetingId.textContent = this.meetingId;
                    this.showToast(`Meeting started! ID: ${this.meetingId}`, 'success');
                } else {
                    this.currentMeetingId.textContent = this.meetingId;
                    this.connectToMeeting();
                }
            });
            
            if (this.isHost) {
                this.peer.on('connection', (conn) => {
                    this.handlePeerConnection(conn);
                });
                
                this.peer.on('call', (call) => {
                    call.answer(this.localStream);
                    this.handlePeerCall(call);
                });
            }
            
        } catch (error) {
            console.error('Error initializing meeting:', error);
            this.showToast('Unable to access camera/microphone', 'error');
        }
    }
    
    connectToMeeting() {
        // Connect to host
        const conn = this.peer.connect(this.meetingId);
        this.handlePeerConnection(conn);
        
        // Call host with our stream
        const call = this.peer.call(this.meetingId, this.localStream);
        this.handlePeerCall(call);
    }
    
    handlePeerConnection(conn) {
        conn.on('open', () => {
            this.peers[conn.peer] = conn;
            
            // Send user info
            conn.send({
                type: 'user-info',
                name: this.userName
            });
            
            // Handle messages
            conn.on('data', (data) => {
                this.handlePeerData(data, conn.peer);
            });
            
            conn.on('close', () => {
                this.removePeer(conn.peer);
            });
        });
    }
    
    handlePeerCall(call) {
        call.on('stream', (remoteStream) => {
            this.addRemoteVideo(call.peer, remoteStream);
        });
        
        call.on('close', () => {
            this.removePeer(call.peer);
        });
    }
    
    handlePeerData(data, peerId) {
        switch (data.type) {
            case 'user-info':
                this.updateParticipantName(peerId, data.name);
                break;
            case 'chat-message':
                this.displayChatMessage(data.name, data.message, false);
                break;
            case 'reaction':
                this.displayReaction(data.reaction);
                break;
            case 'raise-hand':
                this.showToast(`${data.name} raised their hand`, 'info');
                break;
            case 'audio-toggle':
                this.updatePeerAudioStatus(peerId, data.muted);
                break;
            case 'video-toggle':
                this.updatePeerVideoStatus(peerId, data.off);
                break;
        }
    }
    
    addRemoteVideo(peerId, stream) {
        const videoWrapper = document.createElement('div');
        videoWrapper.className = 'video-wrapper';
        videoWrapper.id = `video-${peerId}`;
        
        const video = document.createElement('video');
        video.autoplay = true;
        video.playsinline = true;
        video.srcObject = stream;
        
        const overlay = document.createElement('div');
        overlay.className = 'video-overlay';
        
        const name = document.createElement('span');
        name.className = 'participant-name';
        name.textContent = `Participant ${peerId.slice(-4)}`;
        name.id = `name-${peerId}`;
        
        const controls = document.createElement('div');
        controls.className = 'video-controls';
        
        const micIndicator = document.createElement('span');
        micIndicator.className = 'mic-indicator hidden';
        micIndicator.id = `mic-${peerId}`;
        micIndicator.innerHTML = '<i class="fas fa-microphone-slash"></i>';
        
        const videoIndicator = document.createElement('span');
        videoIndicator.className = 'video-indicator hidden';
        videoIndicator.id = `video-${peerId}`;
        videoIndicator.innerHTML = '<i class="fas fa-video-slash"></i>';
        
        controls.appendChild(micIndicator);
        controls.appendChild(videoIndicator);
        overlay.appendChild(name);
        overlay.appendChild(controls);
        videoWrapper.appendChild(video);
        videoWrapper.appendChild(overlay);
        
        this.videoContainer.appendChild(videoWrapper);
        
        // Add to participants list
        this.addParticipantToList(peerId, name.textContent);
        
        // Update count
        this.updateParticipantCount();
    }
    
    removePeer(peerId) {
        // Remove video element
        const videoElement = document.getElementById(`video-${peerId}`);
        if (videoElement) {
            videoElement.remove();
        }
        
        // Remove from participants list
        const participantItem = document.getElementById(`participant-${peerId}`);
        if (participantItem) {
            participantItem.remove();
        }
        
        // Clean up peer connection
        if (this.peers[peerId]) {
            this.peers[peerId].close();
            delete this.peers[peerId];
        }
        
        this.updateParticipantCount();
        this.showToast('Participant left the meeting', 'info');
    }
    
    updateParticipantName(peerId, name) {
        const nameElement = document.getElementById(`name-${peerId}`);
        if (nameElement) {
            nameElement.textContent = name;
        }
        
        const participantItem = document.getElementById(`participant-${peerId}`);
        if (participantItem) {
            participantItem.querySelector('span').textContent = name;
        }
    }
    
    updatePeerAudioStatus(peerId, muted) {
        const indicator = document.getElementById(`mic-${peerId}`);
        if (indicator) {
            indicator.style.display = muted ? 'block' : 'none';
        }
        
        const participantItem = document.getElementById(`participant-${peerId}`);
        if (participantItem) {
            const micIcon = participantItem.querySelector('.participant-status .fa-microphone, .participant-status .fa-microphone-slash');
            if (micIcon) {
                micIcon.className = muted ? 'fas fa-microphone-slash muted' : 'fas fa-microphone';
            }
        }
    }
    
    updatePeerVideoStatus(peerId, off) {
        const indicator = document.getElementById(`video-${peerId}`);
        if (indicator) {
            indicator.style.display = off ? 'block' : 'none';
        }
        
        const participantItem = document.getElementById(`participant-${peerId}`);
        if (participantItem) {
            const videoIcon = participantItem.querySelector('.participant-status .fa-video, .participant-status .fa-video-slash');
            if (videoIcon) {
                videoIcon.className = off ? 'fas fa-video-slash muted' : 'fas fa-video';
            }
        }
    }
    
    addParticipantToList(peerId, name) {
        const participantItem = document.createElement('div');
        participantItem.className = 'participant-item';
        participantItem.id = `participant-${peerId}`;
        
        participantItem.innerHTML = `
            <i class="fas fa-user"></i>
            <span>${name}</span>
            <div class="participant-status">
                <i class="fas fa-microphone"></i>
                <i class="fas fa-video"></i>
            </div>
        `;
        
        this.participantsList.appendChild(participantItem);
    }
    
    updateParticipantCount() {
        const count = Object.keys(this.peers).length + 1;
        this.participantCount.textContent = count;
    }
    
    toggleMic() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                this.isMuted = !audioTrack.enabled;
                this.micBtn.classList.toggle('active');
                
                const indicator = document.getElementById('localMicIndicator');
                indicator.style.display = this.isMuted ? 'block' : 'none';
                
                // Update local participant status
                const localStatus = document.querySelector('.participant-item:first-child .participant-status .fa-microphone, .participant-item:first-child .participant-status .fa-microphone-slash');
                if (localStatus) {
                    localStatus.className = this.isMuted ? 'fas fa-microphone-slash muted' : 'fas fa-microphone';
                }
                
                // Notify others
                this.broadcastToPeers({
                    type: 'audio-toggle',
                    muted: this.isMuted
                });
            }
        }
    }
    
    toggleVideo() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                this.isVideoOff = !videoTrack.enabled;
                this.videoBtn.classList.toggle('active');
                
                const indicator = document.getElementById('localVideoIndicator');
                indicator.style.display = this.isVideoOff ? 'block' : 'none';
                
                // Update local participant status
                const localStatus = document.querySelector('.participant-item:first-child .participant-status .fa-video, .participant-item:first-child .participant-status .fa-video-slash');
                if (localStatus) {
                    localStatus.className = this.isVideoOff ? 'fas fa-video-slash muted' : 'fas fa-video';
                }
                
                // Notify others
                this.broadcastToPeers({
                    type: 'video-toggle',
                    off: this.isVideoOff
                });
            }
        }
    }
    
    async toggleScreenShare() {
        if (!this.isScreenSharing) {
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: true
                });
                
                // Replace video track with screen share
                const videoTrack = screenStream.getVideoTracks()[0];
                
                // Update local video
                this.localVideo.srcObject = screenStream;
                
                // Notify peers
                Object.values(this.peers).forEach(peer => {
                    const call = this.peer.call(peer.peer, screenStream);
                });
                
                this.isScreenSharing = true;
                this.screenShareBtn.classList.add('active');
                
                // Stop sharing when user ends it
                videoTrack.onended = () => {
                    this.stopScreenShare();
                };
                
                this.showToast('Screen sharing started', 'success');
            } catch (error) {
                console.error('Error sharing screen:', error);
                this.showToast('Failed to share screen', 'error');
            }
        } else {
            this.stopScreenShare();
        }
    }
    
    stopScreenShare() {
        // Restore camera
        this.localVideo.srcObject = this.localStream;
        this.isScreenSharing = false;
        this.screenShareBtn.classList.remove('active');
        this.showToast('Screen sharing stopped', 'info');
    }
    
    raiseHand() {
        this.raiseHandBtn.classList.toggle('active');
        
        // Notify others
        this.broadcastToPeers({
            type: 'raise-hand',
            name: this.userName
        });
        
        if (this.raiseHandBtn.classList.contains('active')) {
            this.showToast('Hand raised', 'success');
            setTimeout(() => {
                this.raiseHandBtn.classList.remove('active');
            }, 3000);
        }
    }
    
    toggleReactionPicker() {
        this.reactionPicker.classList.toggle('hidden');
    }
    
    sendReaction(reaction) {
        // Display local reaction
        this.displayReaction(reaction);
        
        // Send to peers
        this.broadcastToPeers({
            type: 'reaction',
            reaction: reaction
        });
    }
    
    displayReaction(reaction) {
        const reactionElement = document.createElement('div');
        reactionElement.className = 'floating-reaction';
        reactionElement.textContent = reaction;
        reactionElement.style.left = Math.random() * window.innerWidth + 'px';
        reactionElement.style.bottom = '100px';
        
        document.body.appendChild(reactionElement);
        
        setTimeout(() => {
            reactionElement.remove();
        }, 3000);
    }
    
    showPanel(panel) {
        this.sidebar.classList.remove('hidden');
        
        if (panel === 'participants') {
            this.participantsPanel.classList.remove('hidden');
            this.chatPanel.classList.add('hidden');
        } else if (panel === 'chat') {
            this.chatPanel.classList.remove('hidden');
            this.participantsPanel.classList.add('hidden');
            document.getElementById('chatBadge').classList.add('hidden');
        }
    }
    
    hideSidebar() {
        this.sidebar.classList.add('hidden');
    }
    
    sendMessage() {
        const message = this.chatInput.value.trim();
        if (message) {
            // Display local message
            this.displayChatMessage(this.userName, message, true);
            
            // Send to peers
            this.broadcastToPeers({
                type: 'chat-message',
                name: this.userName,
                message: message
            });
            
            this.chatInput.value = '';
        }
    }
    
    displayChatMessage(sender, message, isSelf) {
        const messageElement = document.createElement('div');
        messageElement.className = `chat-message ${isSelf ? 'self' : ''}`;
        
        messageElement.innerHTML = `
            <div class="sender">${sender}</div>
            <div class="content">${message}</div>
        `;
        
        this.chatMessages.appendChild(messageElement);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        
        // Show badge if chat is not visible
        if (this.chatPanel.classList.contains('hidden')) {
            const badge = document.getElementById('chatBadge');
            badge.classList.remove('hidden');
            badge.textContent = parseInt(badge.textContent || '0') + 1;
        }
    }
    
    broadcastToPeers(data) {
        Object.values(this.peers).forEach(peer => {
            peer.send(data);
        });
    }
    
    leaveMeeting() {
        if (confirm('Are you sure you want to leave the meeting?')) {
            // Close all peer connections
            Object.values(this.peers).forEach(peer => {
                peer.close();
            });
            
            // Close peer
            if (this.peer) {
                this.peer.destroy();
            }
            
            // Stop local stream
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
            }
            
            // Redirect or close window
            window.location.href = '/'; // Change this to your join page
        }
    }
    
    generateMeetingId() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let id = '';
        for (let i = 0; i < 10; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return id;
    }
    
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        this.toastContainer.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new VideoMeetingApp();
});