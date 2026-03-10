import { Contact, Interaction, InteractionType } from '../types';
import { db } from '../firebase';
import { collection, doc, setDoc, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/utils';

export interface IntegrationStatus {
  service: string;
  connected: boolean;
  lastSyncAt?: string;
}

export const connectService = async (service: string, userId: string): Promise<boolean> => {
  // In a real app, this would open an OAuth popup
  // For this demo, we'll simulate the popup and success
  
  return new Promise((resolve) => {
    const width = 600;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    
    const popup = window.open(
      'about:blank',
      `connect_${service}`,
      `width=${width},height=${height},left=${left},top=${top}`
    );

    if (popup) {
      popup.document.write(`
        <html>
          <head>
            <title>Connecting to ${service}</title>
            <style>
              body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #0A0A0A; color: white; }
              .loader { border: 4px solid #333; border-top: 4px solid #10b981; border-radius: 50%; width: 40px; height: 40px; animate: spin 1s linear infinite; }
              @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            </style>
          </head>
          <body>
            <div class="loader"></div>
            <h2 style="margin-top: 20px">Connecting to ${service}...</h2>
            <p style="color: #888">Please wait while we authorize your account.</p>
            <script>
              setTimeout(() => {
                window.opener.postMessage({ type: 'INTEGRATION_SUCCESS', service: '${service}' }, '*');
                window.close();
              }, 2000);
            </script>
          </body>
        </html>
      `);
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'INTEGRATION_SUCCESS' && event.data?.service === service) {
        window.removeEventListener('message', handleMessage);
        resolve(true);
      }
    };

    window.addEventListener('message', handleMessage);
  });
};

export const syncInteractions = async (userId: string, contacts: Contact[]): Promise<void> => {
  // Simulate fetching interactions from Gmail, LinkedIn, Instagram, iMessage, WhatsApp
  const services: InteractionType[] = ['gmail', 'linkedin', 'instagram', 'imessage', 'whatsapp'];
  const batch = writeBatch(db);
  
  for (const contact of contacts) {
    // Randomly generate some interactions for demo
    const randomService = services[Math.floor(Math.random() * services.length)];
    
    const interaction: Omit<Interaction, 'id'> = {
      contactId: contact.id,
      type: randomService,
      content: getMockContent(randomService, contact),
      timestamp: new Date().toISOString(),
      ownerId: userId
    };
    
    const interactionRef = doc(collection(db, 'interactions'));
    batch.set(interactionRef, interaction);

    // Also randomly set a reachOutReason for some contacts
    if (Math.random() > 0.7) {
      const reasons = ["LinkedIn Post", "Instagram Post", "Email", "WhatsApp Message"];
      const randomReason = reasons[Math.floor(Math.random() * reasons.length)];
      const contactRef = doc(db, 'contacts', contact.id);
      batch.update(contactRef, { reachOutReason: randomReason });
    }
  }
  
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'interactions/batch');
  }
};

const getMockContent = (type: InteractionType, contact: Contact): string => {
  const name = contact.firstName;
  switch (type) {
    case 'gmail':
      return `Re: Project Update - Hey ${name}, just wanted to follow up on our last meeting...`;
    case 'linkedin':
      return `Congrats on the new role at Nexus! Looking forward to seeing what you do there.`;
    case 'instagram':
      return `Liked your photo from the conference! Looks like a great event.`;
    case 'imessage':
      return `Hey! Are we still on for coffee tomorrow?`;
    case 'whatsapp':
      return `Just sent you the document on WhatsApp. Let me know what you think!`;
    default:
      return `Caught up with ${name} today.`;
  }
};
