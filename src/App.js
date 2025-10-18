import React, { useState, useEffect } from 'react';
import { Send, Users, MessageCircle, Clock, Loader, Bell, LogOut, Home } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'YOUR_SUPABASE_URL';
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const publicRooms = [
  { id: 'morning-crew', name: "Morning Crew", desc: "Early risers unite", emoji: "🌅" },
  { id: 'night-owls', name: "Night Owls", desc: "For the after-hours workers", emoji: "🦉" },
  { id: 'venting-room', name: "The Venting Room", desc: "Bad days welcome", emoji: "😮‍💨" },
  { id: 'parents-wfh', name: "Parents WFH", desc: "Kids + remote work", emoji: "👶" },
];

export default function RemoteWorkerChat() {
  const [currentView, setCurrentView] = useState('onboarding');
  const [profile, setProfile] = useState({
    name: '',
    field: '',
    interests: [],
    timezone: '',
    schedule: '',
    looking: ''
  });
  const [userId, setUserId] = useState(null);
  const [matches, setMatches] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [myConnections, setMyConnections] = useState([]);
  const [currentChat, setCurrentChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);

  // Subscribe to connection requests for current user
  useEffect(() => {
    if (!userId) return;

    const subscription = supabase
      .channel('connection_requests')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'connections',
        filter: `user2_id=eq.${userId}`
      }, () => {
        loadPendingRequests();
      })
      .subscribe();

    loadPendingRequests();
    loadMyConnections();

    return () => {
      subscription.unsubscribe();
    };
  }, [userId]);

  // Subscribe to new messages in current chat
  useEffect(() => {
    if (!currentChat) return;

    const subscription = supabase
      .channel(`messages:${currentChat.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `chat_id=eq.${currentChat.id}`
      }, (payload) => {
        setMessages(prev => [...prev, payload.new]);
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [currentChat]);

  // Load messages when entering a chat
  useEffect(() => {
    if (currentChat) {
      loadMessages(currentChat.id);
    }
  }, [currentChat]);

  const loadPendingRequests = async () => {
    try {
      const { data, error } = await supabase
        .from('connections')
        .select('*, user1:user1_id(name, field, interests, timezone)')
        .eq('user2_id', userId)
        .eq('status', 'pending');

      if (error) throw error;
      setPendingRequests(data || []);
    } catch (error) {
      console.error('Error loading requests:', error);
    }
  };

  const loadMyConnections = async () => {
    try {
      const { data, error } = await supabase
        .from('connections')
        .select('*, user1:user1_id(name), user2:user2_id(name)')
        .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
        .eq('status', 'accepted');

      if (error) throw error;
      setMyConnections(data || []);
    } catch (error) {
      console.error('Error loading connections:', error);
    }
  };

  const handleProfileUpdate = (field, value) => {
    setProfile(prev => ({ ...prev, [field]: value }));
  };

  const handleInterestToggle = (interest) => {
    setProfile(prev => ({
      ...prev,
      interests: prev.interests.includes(interest)
        ? prev.interests.filter(i => i !== interest)
        : [...prev.interests, interest]
    }));
  };

  const createProfile = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('users')
        .insert([{
          name: profile.name,
          field: profile.field,
          interests: profile.interests,
          timezone: profile.timezone,
          schedule: profile.schedule,
          looking_for: profile.looking,
          online_status: true
        }])
        .select()
        .single();

      if (error) throw error;
      
      setUserId(data.id);
      await findMatches(data.id);
    } catch (error) {
      console.error('Error creating profile:', error);
      alert('Error creating profile. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const findMatches = async (currentUserId) => {
    setLoading(true);
    try {
      const { data: allUsers, error } = await supabase
        .from('users')
        .select('*')
        .neq('id', currentUserId)
        .limit(20);

      if (error) throw error;

      const scored = allUsers.map(user => {
        let score = 0;
        if (user.timezone === profile.timezone) score += 3;
        if (user.schedule === profile.schedule) score += 2;
        if (user.looking_for === profile.looking) score += 2;
        const sharedInterests = user.interests?.filter(i => profile.interests.includes(i)).length || 0;
        score += sharedInterests;
        return { ...user, score };
      });

      const topMatches = scored
        .sort((a, b) => b.score - a.score)
        .slice(0, 6);

      setMatches(topMatches);
      setCurrentView('dashboard');
    } catch (error) {
      console.error('Error finding matches:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async (chatId) => {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages(data || []);
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || !currentChat || !userId) return;

    try {
      const { error } = await supabase
        .from('messages')
        .insert([{
          chat_id: currentChat.id,
          sender_id: userId,
          sender_name: profile.name,
          text: inputMessage,
          chat_type: currentChat.type || 'room'
        }]);

      if (error) throw error;
      setInputMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message');
    }
  };

  const createConnection = async (matchedUser) => {
    setLoading(true);
    try {
      const chatId = `chat-${Math.min(userId, matchedUser.id)}-${Math.max(userId, matchedUser.id)}`;
      
      const { error } = await supabase
        .from('connections')
        .insert([{
          user1_id: userId,
          user2_id: matchedUser.id,
          chat_id: chatId,
          status: 'pending'
        }]);

      if (error) throw error;
      alert(`Connection request sent to ${matchedUser.name}!`);
    } catch (error) {
      console.error('Error creating connection:', error);
      alert('Failed to send connection request');
    } finally {
      setLoading(false);
    }
  };

  const respondToRequest = async (connectionId, accept, chatId) => {
    try {
      const { error } = await supabase
        .from('connections')
        .update({ status: accept ? 'accepted' : 'declined' })
        .eq('id', connectionId);

      if (error) throw error;
      
      loadPendingRequests();
      loadMyConnections();
      
      if (accept) {
        alert('Connection accepted! You can now chat.');
      }
    } catch (error) {
      console.error('Error responding to request:', error);
    }
  };

  const openChat = (connection) => {
    const otherUser = connection.user1_id === userId ? connection.user2 : connection.user1;
    setCurrentChat({
      id: connection.chat_id,
      name: otherUser.name,
      type: 'direct'
    });
    setCurrentView('chat');
  };

  // Onboarding View
  if (currentView === 'onboarding') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-block p-3 bg-white rounded-2xl shadow-lg mb-4">
              <MessageCircle className="text-violet-600" size={40} />
            </div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Remote Lounge</h1>
            <p className="text-gray-600">Your space to connect with remote workers</p>
          </div>

          <div className="bg-white rounded-3xl shadow-xl p-6 space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Your name</label>
              <input
                type="text"
                value={profile.name}
                onChange={(e) => handleProfileUpdate('name', e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border-0 rounded-xl focus:ring-2 focus:ring-violet-500 focus:bg-white transition"
                placeholder="What should we call you?"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Field</label>
              <select
                value={profile.field}
                onChange={(e) => handleProfileUpdate('field', e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border-0 rounded-xl focus:ring-2 focus:ring-violet-500 focus:bg-white transition"
              >
                <option value="">Choose your field</option>
                <option value="Engineering">Engineering</option>
                <option value="Design">Design</option>
                <option value="Marketing">Marketing</option>
                <option value="Product">Product</option>
                <option value="Sales">Sales</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Timezone</label>
              <select
                value={profile.timezone}
                onChange={(e) => handleProfileUpdate('timezone', e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border-0 rounded-xl focus:ring-2 focus:ring-violet-500 focus:bg-white transition"
              >
                <option value="">Select timezone</option>
                <option value="PST">Pacific (PST)</option>
                <option value="MST">Mountain (MST)</option>
                <option value="CST">Central (CST)</option>
                <option value="EST">Eastern (EST)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-3">Work schedule</label>
              <div className="grid grid-cols-2 gap-2">
                {['morning', 'afternoon', 'evening', 'night'].map(time => (
                  <button
                    key={time}
                    onClick={() => handleProfileUpdate('schedule', time)}
                    className={`px-4 py-3 rounded-xl font-medium transition ${
                      profile.schedule === time
                        ? 'bg-violet-600 text-white shadow-lg shadow-violet-200'
                        : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {time.charAt(0).toUpperCase() + time.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-3">Interests</label>
              <div className="flex flex-wrap gap-2">
                {['Photography', 'Gaming', 'Cooking', 'Reading', 'Hiking', 'Yoga', 'Coffee', 'Music'].map(interest => (
                  <button
                    key={interest}
                    onClick={() => handleInterestToggle(interest)}
                    className={`px-3 py-2 rounded-full text-sm font-medium transition ${
                      profile.interests.includes(interest)
                        ? 'bg-violet-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {interest}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-3">Looking for</label>
              <div className="space-y-2">
                {[
                  { value: 'casual', label: 'Daily check-ins', icon: '💬' },
                  { value: 'cowork', label: 'Coworking buddy', icon: '⏰' },
                  { value: 'weekly', label: 'Weekly coffee chats', icon: '☕' },
                  { value: 'venting', label: 'Venting space', icon: '😮‍💨' }
                ].map(option => (
                  <button
                    key={option.value}
                    onClick={() => handleProfileUpdate('looking', option.value)}
                    className={`w-full px-4 py-3 rounded-xl text-left font-medium transition ${
                      profile.looking === option.value
                        ? 'bg-violet-600 text-white shadow-lg shadow-violet-200'
                        : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <span className="mr-2 text-lg">{option.icon}</span>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={createProfile}
              disabled={!profile.name || !profile.timezone || !profile.schedule || !profile.looking || loading}
              className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white py-4 rounded-xl font-bold shadow-lg shadow-violet-200 hover:shadow-xl hover:scale-105 transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader className="animate-spin" size={20} />
                  Finding your people...
                </>
              ) : (
                'Find My People'
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Dashboard View
  if (currentView === 'dashboard') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50">
        {/* Header */}
        <div className="bg-white/80 backdrop-blur-lg border-b border-gray-200/50 sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-violet-600 to-fuchsia-600 rounded-xl">
                <MessageCircle className="text-white" size={24} />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Remote Lounge</h1>
                <p className="text-xs text-gray-500">Hey, {profile.name}!</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentView('rooms')}
                className="flex items-center gap-2 px-4 py-2 bg-violet-100 text-violet-700 rounded-xl hover:bg-violet-200 transition font-medium"
              >
                <Users size={18} />
                <span className="hidden sm:inline">Rooms</span>
              </button>
              {pendingRequests.length > 0 && (
                <div className="relative">
                  <Bell className="text-violet-600" size={24} />
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                    {pendingRequests.length}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto p-4 space-y-6">
          {/* Connection Requests */}
          {pendingRequests.length > 0 && (
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Bell className="text-violet-600" size={24} />
                Connection Requests
              </h2>
              <div className="space-y-3">
                {pendingRequests.map(request => (
                  <div key={request.id} className="flex items-center justify-between p-4 bg-violet-50 rounded-xl">
                    <div>
                      <p className="font-semibold text-gray-900">{request.user1.name}</p>
                      <p className="text-sm text-gray-600">{request.user1.field} • {request.user1.timezone}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => respondToRequest(request.id, true, request.chat_id)}
                        className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition font-medium"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => respondToRequest(request.id, false)}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-medium"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* My Connections */}
          {myConnections.length > 0 && (
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Your Connections</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {myConnections.map(connection => {
                  const otherUser = connection.user1_id === userId ? connection.user2 : connection.user1;
                  return (
                    <button
                      key={connection.id}
                      onClick={() => openChat(connection)}
                      className="p-4 bg-gradient-to-br from-violet-50 to-fuchsia-50 rounded-xl hover:shadow-md transition text-left"
                    >
                      <p className="font-semibold text-gray-900">{otherUser.name}</p>
                      <p className="text-sm text-gray-600">Click to chat</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Suggested Matches */}
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">People You Might Like</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {matches.map(user => (
                <div key={user.id} className="bg-gradient-to-br from-violet-50 to-fuchsia-50 rounded-2xl p-5 hover:shadow-lg transition">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">{user.name}</h3>
                      <p className="text-sm text-gray-600">{user.field}</p>
                    </div>
                    <span className="px-2 py-1 bg-white rounded-lg text-xs font-semibold text-violet-600">
                      {user.timezone}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-4">
                    {user.interests?.slice(0, 3).map(interest => (
                      <span key={interest} className="px-2 py-1 bg-white rounded-lg text-xs text-gray-700">
                        {interest}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => createConnection(user)}
                    disabled={loading}
                    className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white py-2 rounded-xl font-semibold hover:shadow-lg transition disabled:opacity-50"
                  >
                    Connect
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Public Rooms View
  if (currentView === 'rooms') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50">
        <div className="bg-white/80 backdrop-blur-lg border-b border-gray-200/50 sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
            <button
              onClick={() => setCurrentView('dashboard')}
              className="flex items-center gap-2 text-gray-700 hover:text-gray-900 font-medium"
            >
              <Home size={20} />
              Back to Dashboard
            </button>
          </div>
        </div>

        <div className="max-w-6xl mx-auto p-4">
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">Public Rooms</h2>
            <p className="text-gray-600 mb-6">Drop in anytime, chat with anyone</p>

            <div className="grid sm:grid-cols-2 gap-4">
              {publicRooms.map(room => (
                <button
                  key={room.id}
                  onClick={() => {
                    setCurrentChat({ id: room.id, name: room.name, type: 'room' });
                    setCurrentView('chat');
                  }}
                  className="p-6 bg-gradient-to-br from-violet-50 to-fuchsia-50 rounded-2xl hover:shadow-lg transition text-left group"
                >
                  <div className="text-4xl mb-3">{room.emoji}</div>
                  <h3 className="text-xl font-bold text-gray-900 mb-1 group-hover:text-violet-600 transition">{room.name}</h3>
                  <p className="text-gray-600">{room.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Chat View
  if (currentView === 'chat' && currentChat) {
    const isRoom = currentChat.type === 'room';

    return (
      <div className="h-screen flex flex-col bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50">
        <div className="bg-white/80 backdrop-blur-lg border-b border-gray-200/50">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setCurrentView(isRoom ? 'rooms' : 'dashboard');
                  setCurrentChat(null);
                }}
                className="text-gray-600 hover:text-gray-900 font-medium"
              >
                ← Back
              </button>
              <div>
                <h2 className="text-lg font-bold text-gray-900">{currentChat.name}</h2>
                <p className="text-xs text-gray-500">{isRoom ? 'Public room' : 'Direct message'}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-4xl mx-auto space-y-4">
            {messages.length === 0 ? (
              <div className="text-center py-12">
                <div className="inline-block p-4 bg-white rounded-2xl shadow-lg mb-4">
                  <MessageCircle size={48} className="text-violet-300" />
                </div>
                <p className="text-gray-500 font-medium">
                  {isRoom ? 'No messages yet. Start the conversation!' : 'Send a message to start chatting'}
                </p>
              </div>
            ) : (
              messages.map(msg => {
                const isMe = msg.sender_id === userId;
                return (
                  <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-md ${isMe ? '' : 'mr-auto'}`}>
                      {!isMe && <p className="text-xs font-semibold text-gray-600 mb-1 ml-3">{msg.sender_name}</p>}
                      <div className={`px-5 py-3 rounded-2xl shadow-sm ${
                        isMe
                          ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white'
                          : 'bg-white text-gray-900'
                      }`}>
                        <p className="leading-relaxed">{msg.text}</p>
                        <span className={`text-xs mt-1 block ${
                          isMe ? 'text-violet-100' : 'text-gray-400'
                        }`}>
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="bg-white/80 backdrop-blur-lg border-t border-gray-200/50 p-4">
          <div className="max-w-4xl mx-auto flex gap-3">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Type your message..."
              className="flex-1 px-5 py-3 bg-white border-0 rounded-2xl shadow-sm focus:ring-2 focus:ring-violet-500 transition"
            />
            <button
              onClick={sendMessage}
              className="px-6 py-3 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white rounded-2xl hover:shadow-lg transition flex items-center gap-2 font-semibold"
            >
              <Send size={20} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}