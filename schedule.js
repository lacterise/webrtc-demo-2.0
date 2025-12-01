document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("scheduleForm");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    // Get form data
    const topic = document.getElementById('topic').value;
    const description = document.getElementById('description').value;
    const when = document.getElementById('when').value;
    const duration = document.getElementById('duration').value;
    const timezone = document.getElementById('timezone').value;
    const password = document.getElementById('password').value;
    const video = document.getElementById('video').value;
    const participantVideo = document.getElementById('participantVideo').value;
    const audio = document.getElementById('audio').value;
    
    // Generate meeting ID (6 random characters)
    const meetingID = Math.random().toString(36).substring(2, 8);
    
    // Get the actual IP address of the host device
    const hostIP = await getHostIP();
    
    // Store meeting data in localStorage
    localStorage.setItem('meetingData', JSON.stringify({
      hostIP: hostIP,
      meetingID: meetingID,
      peerId: meetingID, // Added this line so the Host uses this ID in meeting-room.js
      username: "Host",
      password: password,
      isHost: true,
      scheduledMeeting: {
        topic: topic,
        description: description,
        when: when,
        duration: duration,
        timezone: timezone,
        video: video,
        participantVideo: participantVideo,
        audio: audio
      }
    }));

    // Show success message and redirect
    alert("Meeting scheduled successfully! Starting the meeting room...");
    
    // Redirect to meeting room
    window.location.href = 'meeting-room.html';
  });

  async function getHostIP() {
    try {
      // Method 1: Try to get local IP using WebRTC
      const localIP = await getLocalIP();
      if (localIP) {
        return localIP;
      }
    } catch (error) {
      console.log('Could not get local IP:', error);
    }

    try {
      // Method 2: Get public IP using external service
      const publicIP = await getPublicIP();
      if (publicIP) {
        return publicIP;
      }
    } catch (error) {
      console.log('Could not get public IP:', error);
    }

    // Fallback: Return a placeholder
    return "IP_DETECTION_FAILED";
  }

  async function getLocalIP() {
    return new Promise((resolve) => {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });

      pc.createDataChannel('');
      
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const candidate = event.candidate.candidate;
          const ipMatch = candidate.match(/([0-9]{1,3}(\.[0-9]{1,3}){3}|[a-f0-9]{1,4}(:[a-f0-9]{1,4}){7})/);
          if (ipMatch) {
            const ip = ipMatch[1];
            // Filter out non-local IPs
            if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
              pc.close();
              resolve(ip);
            }
          }
        }
      };

      pc.createOffer().then(offer => pc.setLocalDescription(offer));
      
      // Timeout after 5 seconds
      setTimeout(() => {
        pc.close();
        resolve(null);
      }, 5000);
    });
  }

  async function getPublicIP() {
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      return data.ip;
    } catch (error) {
      // Fallback to another service
      try {
        const response = await fetch('https://ipapi.co/ip/');
        return await response.text();
      } catch (error2) {
        throw error2;
      }
    }
  }
});