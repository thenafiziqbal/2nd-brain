// push-notifications-enhanced.js — Enhanced push notification system
// Ensures notifications are sent even when the app is closed/in background
import { db, doc, getDoc, collection, query, where, onSnapshot } from './firebase-init.js';
import { state } from './store.js';

export async function initEnhancedPushNotifications(){
  // Request notification permission if not already granted
  if('Notification' in window && Notification.permission === 'default'){
    setTimeout(() => {
      const ok = confirm('🔔 Allow push notifications for important updates?');
      if(ok) Notification.requestPermission();
    }, 3000);
  }
  
  // Watch for system announcements and send as push notifications
  if(state.user){
    try {
      watchAnnouncementsForPush();
    } catch(e) {
      console.warn('Push notification watch failed:', e);
    }
  }
}

function watchAnnouncementsForPush(){
  // Watch admin announcements and send them as push notifications
  const q = query(collection(db, 'system', 'announcements_queue', 'pending'));
  try {
    onSnapshot(q, (snap) => {
      snap.docs.forEach(doc => {
        const data = doc.data();
        if(data.sentAt) return; // Already sent
        
        sendNotification({
          title: data.title || 'Announcement',
          body: data.body || data.message || '',
          icon: data.icon || '/assets/icon-192.png.svg',
          tag: 'announcement-' + doc.id,
          requireInteraction: data.requireInteraction !== false,
          data: {
            link: data.link || '',
            action: data.action || ''
          }
        });
        
        // Mark as sent
        doc.ref.update({ sentAt: new Date() }).catch(()=>{});
      });
    }).catch(()=>{});
  } catch(e) {
    console.warn('Announcement watch failed:', e);
  }
}

export async function sendNotification(options){
  if(!('Notification' in window)) return;
  if(Notification.permission !== 'granted') return;
  
  try {
    // If service worker is available, use it
    if(navigator.serviceWorker?.ready){
      const reg = await navigator.serviceWorker.ready;
      if(reg.showNotification){
        reg.showNotification(options.title, {
          body: options.body,
          icon: options.icon || '/assets/icon-192.png.svg',
          badge: '/assets/icon-192.png.svg',
          tag: options.tag || 'notif-' + Date.now(),
          requireInteraction: options.requireInteraction ?? false,
          data: options.data || {}
        });
        return;
      }
    }
    
    // Fallback to direct notification
    new Notification(options.title, {
      body: options.body,
      icon: options.icon || '/assets/icon-192.png.svg',
      tag: options.tag || 'notif-' + Date.now(),
      requireInteraction: options.requireInteraction ?? false,
    });
  } catch(e) {
    console.warn('Failed to send notification:', e);
  }
}

// Background notification handler — triggered even when app is closed
export function handleBackgroundNotification(event) {
  if(event.notification?.data?.link){
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then(windowClients => {
        // Try to focus existing window
        for(let i = 0; i < windowClients.length; i++){
          const client = windowClients[i];
          if(client.url === event.notification.data.link && 'focus' in client) return client.focus();
        }
        // Or open new window if no existing client
        if(clients.openWindow) return clients.openWindow(event.notification.data.link);
      })
    );
  }
  event.notification.close();
}
