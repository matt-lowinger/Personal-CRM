import React, { useState, useEffect, useMemo } from 'react';
import { auth, db, signIn, signOut } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  setDoc, 
  getDoc,
  deleteDoc,
  writeBatch,
  getDocs,
  orderBy,
  limit
} from 'firebase/firestore';
import { getOutreachInsights, AISuggestion } from './services/aiService';
import { findSocialProfiles } from './services/socialService';
import { connectService, syncInteractions } from './services/integrationService';
import { 
  Users, 
  MessageSquare, 
  Settings as SettingsIcon, 
  LogOut, 
  Plus, 
  Search,
  Bell,
  ChevronRight,
  Mail,
  Linkedin,
  Instagram,
  Phone,
  Check,
  Rss,
  Calendar,
  RefreshCw,
  Filter,
  Sparkles,
  Clock,
  MessageCircle,
  Lightbulb,
  Trash2,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, addDays, subDays, isBefore, parseISO } from 'date-fns';
import { Contact, Interaction, Settings, ContactLevel, InteractionType } from './types';
import { cn, handleFirestoreError, OperationType } from './lib/utils';
import { ImportContacts } from './components/ImportContacts';

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'contacts' | 'settings'>('dashboard');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [isAddContactOpen, setIsAddContactOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [aiInsights, setAiInsights] = useState<AISuggestion | null>(null);
  const [integrationStatuses, setIntegrationStatuses] = useState<Record<string, boolean>>({
    gmail: true,
    linkedin: false,
    instagram: false,
    imessage: true,
    rss: true,
    whatsapp: false
  });
  const [newContact, setNewContact] = useState<Partial<Contact>>({
    firstName: '',
    lastName: '',
    level: 'B',
    tags: []
  });
  const [isEditing, setIsEditing] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [showDeleteContactConfirm, setShowDeleteContactConfirm] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) {
      setContacts([]);
      return;
    }
    const q = query(collection(db, 'contacts'), where('ownerId', '==', user.uid));
    const unsub = onSnapshot(q, (snapshot) => {
      const newContacts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contact));
      setContacts(newContacts);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'contacts');
    });
    return unsub;
  }, [user]);

  // Keep selected contact in sync with contacts list
  useEffect(() => {
    if (selectedContact) {
      const updated = contacts.find(c => c.id === selectedContact.id);
      if (updated && updated !== selectedContact) {
        setSelectedContact(updated);
      }
    }
  }, [contacts, selectedContact]);

  useEffect(() => {
    if (!user) {
      setSettings(null);
      return;
    }
    const docRef = doc(db, 'settings', user.uid);
    const unsub = onSnapshot(docRef, async (snapshot) => {
      if (snapshot.exists()) {
        setSettings(snapshot.data() as Settings);
      } else {
        // Initialize default settings
        const defaultSettings: Settings = {
          frequencies: {
            A: 7,
            B: 30,
            C: 90,
            D: 180
          },
          ownerId: user.uid
        };
        await setDoc(docRef, defaultSettings);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `settings/${user.uid}`);
    });
    return unsub;
  }, [user]);

  useEffect(() => {
    if (!user) {
      setIntegrationStatuses({
        gmail: true,
        linkedin: false,
        instagram: false,
        imessage: true,
        rss: true,
        whatsapp: false
      });
      return;
    }
    const q = query(collection(db, 'integrations'), where('ownerId', '==', user.uid));
    const unsub = onSnapshot(q, (snapshot) => {
      const statuses: Record<string, boolean> = {
        gmail: true,
        linkedin: false,
        instagram: false,
        imessage: true,
        rss: true,
        whatsapp: false
      };
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.service) {
          statuses[data.service.toLowerCase()] = true;
        }
      });
      setIntegrationStatuses(statuses);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'integrations');
    });
    return unsub;
  }, [user]);

  useEffect(() => {
    setAiInsights(null);
    if (!user || !selectedContact) return;
    const qInteractions = query(
      collection(db, 'interactions'), 
      where('contactId', '==', selectedContact.id),
      where('ownerId', '==', user.uid),
      orderBy('timestamp', 'desc')
    );
    const unsubInteractions = onSnapshot(qInteractions, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Interaction));
      setInteractions(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'interactions');
    });
    return unsubInteractions;
  }, [user, selectedContact]);

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newContact.firstName) return;

    try {
      const contactData: Omit<Contact, 'id'> = {
        firstName: newContact.firstName,
        lastName: newContact.lastName || '',
        email: newContact.email || '',
        phone: newContact.phone || '',
        linkedinUrl: newContact.linkedinUrl || '',
        instagramHandle: newContact.instagramHandle || '',
        level: newContact.level as ContactLevel,
        tags: newContact.tags || [],
        ownerId: user.uid,
        socialScanStatus: 'pending',
        nextOutreachAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };
      
      const docRef = doc(collection(db, 'contacts'));
      try {
        await setDoc(docRef, contactData);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'contacts');
      }
      setIsAddContactOpen(false);
      setNewContact({ firstName: '', lastName: '', level: 'B', tags: [] });

      // Trigger social scan
      const fullName = `${contactData.firstName} ${contactData.lastName}`.trim();
      findSocialProfiles(fullName, contactData.email).then(social => {
        if (social.linkedinUrl || social.instagramHandle) {
          setDoc(docRef, {
            linkedinUrl: social.linkedinUrl || null,
            instagramHandle: social.instagramHandle || null,
            socialScanStatus: 'completed'
          }, { merge: true }).catch(err => handleFirestoreError(err, OperationType.UPDATE, `contacts/${docRef.id}`));
        } else {
          setDoc(docRef, { socialScanStatus: 'failed' }, { merge: true }).catch(err => handleFirestoreError(err, OperationType.UPDATE, `contacts/${docRef.id}`));
        }
      }).catch(console.error);
    } catch (error) {
      console.error("Error adding contact:", error);
    }
  };

  const handleUpdateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !editContact) return;

    try {
      const { id, ...data } = editContact;
      try {
        await setDoc(doc(db, 'contacts', id), data, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `contacts/${id}`);
      }
      setSelectedContact(editContact);
      setIsEditing(false);
    } catch (error) {
      console.error("Error updating contact:", error);
    }
  };

  const getReachOutReason = (contact: Contact) => {
    if (contact.reachOutReason) return contact.reachOutReason;
    
    const now = new Date();
    const nextOutreach = contact.nextOutreachAt ? new Date(contact.nextOutreachAt) : null;
    
    if (nextOutreach && isBefore(nextOutreach, now)) {
      return "Time to Reach Out";
    }
    
    return "No immediate action needed"; 
  };

  const handleUpdateFrequency = async (level: ContactLevel, days: number) => {
    if (!user || !settings) return;
    try {
      const newFrequencies = { ...settings.frequencies, [level]: days };
      try {
        await setDoc(doc(db, 'settings', user.uid), { frequencies: newFrequencies }, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `settings/${user.uid}`);
      }
    } catch (error) {
      console.error("Error updating frequency:", error);
    }
  };

  const [rssFeeds, setRssFeeds] = useState<string[]>([]);
  const [newRssUrl, setNewRssUrl] = useState('');

  useEffect(() => {
    if (!user) return;
    const qIntegrations = query(collection(db, 'integrations'), where('ownerId', '==', user.uid), where('service', '==', 'rss'));
    const unsub = onSnapshot(qIntegrations, (snapshot) => {
      const feeds = snapshot.docs.map(doc => doc.data().url);
      setRssFeeds(feeds);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'integrations');
    });
    return unsub;
  }, [user]);

  const handleLogInteraction = async (type: InteractionType, content: string) => {
    if (!user || !selectedContact) return;

    try {
      const interactionData: Omit<Interaction, 'id'> = {
        contactId: selectedContact.id,
        type,
        content,
        timestamp: new Date().toISOString(),
        ownerId: user.uid
      };

      try {
        await setDoc(doc(collection(db, 'interactions')), interactionData);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'interactions');
      }
      
      // Update contact's last interaction and next outreach
      const freq = settings?.frequencies[selectedContact.level] || 30;
      const nextOutreach = addDays(new Date(), freq).toISOString();
      
      try {
        await setDoc(doc(db, 'contacts', selectedContact.id), {
          lastInteractionAt: new Date().toISOString(),
          nextOutreachAt: nextOutreach
        }, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `contacts/${selectedContact.id}`);
      }

    } catch (error) {
      console.error("Error logging interaction:", error);
    }
  };

  const handleAddRss = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newRssUrl) return;
    try {
      await setDoc(doc(collection(db, 'integrations')), {
        service: 'rss',
        url: newRssUrl,
        ownerId: user.uid
      });
      setNewRssUrl('');
    } catch (error) {
      console.error("Error adding RSS:", error);
    }
  };

  const handleTriggerOutreach = async (contactId: string, reason: string) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'contacts', contactId), {
        nextOutreachAt: new Date().toISOString()
      }, { merge: true });
      
      await setDoc(doc(collection(db, 'interactions')), {
        contactId,
        type: 'manual',
        content: `System Trigger: ${reason}`,
        timestamp: new Date().toISOString(),
        ownerId: user.uid
      });
    } catch (error) {
      console.error("Error triggering outreach:", error);
    }
  };

  const handleSyncInteractions = async (contact: Contact) => {
    if (!user) return;
    setIsSyncing(true);
    
    try {
      // Check which services are connected
      const connectedServices = Object.entries(integrationStatuses)
        .filter(([_, connected]) => connected)
        .map(([service]) => service);

      if (connectedServices.length === 0) {
        alert("Please connect at least one service in Settings to sync interactions.");
        setIsSyncing(false);
        return;
      }

      const fullName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim();
      const mockData: Omit<Interaction, 'id'>[] = [];

      if (integrationStatuses.gmail) {
        mockData.push({
          contactId: contact.id,
          type: 'gmail',
          content: `Email from ${fullName || contact.email}: "Re: Project Update" - Looking forward to our next meeting.`,
          timestamp: subDays(new Date(), 1).toISOString(),
          ownerId: user.uid
        });
      }

      if (integrationStatuses.linkedin && contact.linkedinUrl) {
        mockData.push({
          contactId: contact.id,
          type: 'linkedin',
          content: `${fullName} updated their profile: "Senior Product Manager at Vercel"`,
          timestamp: subDays(new Date(), 3).toISOString(),
          ownerId: user.uid
        });
      }

      if (integrationStatuses.whatsapp && contact.phone) {
        mockData.push({
          contactId: contact.id,
          type: 'whatsapp',
          content: `Message from ${fullName || contact.phone}: "Hey, are we still on for coffee?"`,
          timestamp: subDays(new Date(), 5).toISOString(),
          ownerId: user.uid
        });
      }

      if (integrationStatuses.instagram && contact.instagramHandle) {
        mockData.push({
          contactId: contact.id,
          type: 'instagram',
          content: `${fullName} liked your recent post.`,
          timestamp: subDays(new Date(), 7).toISOString(),
          ownerId: user.uid
        });
      }

      if (integrationStatuses.imessage && contact.phone) {
        mockData.push({
          contactId: contact.id,
          type: 'imessage',
          content: `iMessage from ${fullName}: "Just saw your update, congrats!"`,
          timestamp: subDays(new Date(), 2).toISOString(),
          ownerId: user.uid
        });
      }

      for (const item of mockData) {
        // For simulation, we just add them if they don't exist in current state
        const exists = interactions.some(i => i.content === item.content);
        if (!exists) {
          await setDoc(doc(collection(db, 'interactions')), item);
        }
      }
      
      // Update last interaction if the newest mock is newer than current
      if (mockData.length > 0) {
        const newest = mockData[0].timestamp;
        if (!contact.lastInteractionAt || isBefore(parseISO(contact.lastInteractionAt), parseISO(newest))) {
          const freq = settings?.frequencies[contact.level] || 30;
          const nextOutreach = addDays(parseISO(newest), freq).toISOString();
          await setDoc(doc(db, 'contacts', contact.id), {
            lastInteractionAt: newest,
            nextOutreachAt: nextOutreach
          }, { merge: true });
        }
      }
    } catch (error) {
      console.error("Error syncing interactions:", error);
    } finally {
      setTimeout(() => setIsSyncing(false), 1000); // Visual feedback
    }
  };

  const handleGetAIInsights = async () => {
    if (!selectedContact) return;
    setIsAnalyzing(true);
    try {
      const insights = await getOutreachInsights(selectedContact, interactions);
      setAiInsights(insights);
    } catch (error) {
      console.error("Failed to get AI insights:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const [allInteractions, setAllInteractions] = useState<Interaction[]>([]);
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'interactions'), where('ownerId', '==', user.uid), orderBy('timestamp', 'desc'), limit(10));
    const unsub = onSnapshot(q, (snapshot) => {
      setAllInteractions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Interaction)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'interactions');
    });
    return unsub;
  }, [user]);

  const handleConnect = async (service: string) => {
    if (!user) return;
    try {
      const success = await connectService(service, user.uid);
      if (success) {
        try {
          await setDoc(doc(collection(db, 'integrations')), {
            service,
            ownerId: user.uid,
            connectedAt: new Date().toISOString()
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, 'integrations');
        }
        setIntegrationStatuses(prev => ({ ...prev, [service.toLowerCase()]: true }));
      }
    } catch (error) {
      console.error(`Error connecting to ${service}:`, error);
    }
  };

  const handleSyncAll = async () => {
    if (!user || contacts.length === 0) return;
    setIsSyncing(true);
    try {
      // Use the more robust logic from handleSyncInteractions for each contact
      for (const contact of contacts) {
        await handleSyncInteractions(contact);
      }
    } catch (error) {
      console.error("Error syncing interactions:", error);
    } finally {
      setIsSyncing(false);
    }
  };
  const handleManualScan = async () => {
    if (!selectedContact) return;
    try {
      const contactRef = doc(db, 'contacts', selectedContact.id);
      await setDoc(contactRef, { socialScanStatus: 'scanning' }, { merge: true });
      const fullName = `${selectedContact.firstName} ${selectedContact.lastName}`.trim();
      const social = await findSocialProfiles(fullName, selectedContact.email);
      await setDoc(contactRef, {
        linkedinUrl: social.linkedinUrl || selectedContact.linkedinUrl || null,
        instagramHandle: social.instagramHandle || selectedContact.instagramHandle || null,
        socialScanStatus: social.linkedinUrl || social.instagramHandle ? 'completed' : 'failed'
      }, { merge: true });
    } catch (error) {
      console.error("Manual scan failed:", error);
    }
  };

  const [apiKeySelected, setApiKeySelected] = useState(true);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setApiKeySelected(hasKey);
      }
    };
    checkKey();
  }, []);

  const handleOpenKeySelector = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setApiKeySelected(true);
    }
  };

  const handleDeleteAllContacts = async () => {
    if (!user) return;
    
    setIsSyncing(true);
    setShowDeleteAllConfirm(false);
    try {
      // Delete contacts in chunks of 500
      const q = query(collection(db, 'contacts'), where('ownerId', '==', user.uid));
      const snapshot = await getDocs(q);
      
      let batch = writeBatch(db);
      let count = 0;
      
      for (const doc of snapshot.docs) {
        batch.delete(doc.ref);
        count++;
        if (count === 500) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) await batch.commit();
      
      // Delete interactions in chunks of 500
      const iq = query(collection(db, 'interactions'), where('ownerId', '==', user.uid));
      const iSnapshot = await getDocs(iq);
      
      batch = writeBatch(db);
      count = 0;
      
      for (const doc of iSnapshot.docs) {
        batch.delete(doc.ref);
        count++;
        if (count === 500) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) await batch.commit();
      
      setSelectedContact(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'contacts/batch');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDeleteContact = async (contactId: string) => {
    if (!user) return;
    
    try {
      await deleteDoc(doc(db, 'contacts', contactId));
      setSelectedContact(null);
      setIsEditing(false);
      setShowDeleteContactConfirm(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `contacts/${contactId}`);
    }
  };

  const filteredContacts = useMemo(() => {
    return contacts.filter(contact => {
      if (!searchTerm) return true;
      const searchStr = searchTerm.toLowerCase();
      const firstName = contact.firstName?.toLowerCase() || '';
      const lastName = contact.lastName?.toLowerCase() || '';
      const email = contact.email?.toLowerCase() || '';
      const fullName = `${firstName} ${lastName}`.trim();
      
      return fullName.includes(searchStr) || 
             email.includes(searchStr) ||
             contact.tags?.some(tag => tag.toLowerCase().includes(searchStr));
    });
  }, [contacts, searchTerm]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="space-y-2">
            <h1 className="text-5xl font-bold tracking-tighter text-white">NEXUS</h1>
            <p className="text-zinc-400 text-lg">Your network, amplified.</p>
          </div>
          <button
            onClick={signIn}
            className="w-full py-4 bg-white text-black font-semibold rounded-2xl hover:bg-zinc-200 transition-colors flex items-center justify-center gap-3"
          >
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
            Continue with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-zinc-100 flex">
      {/* Sidebar */}
      <aside className="w-20 lg:w-64 border-r border-zinc-800 flex flex-col p-4">
        <div className="flex items-center gap-3 px-2 mb-12">
          <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
            <Users className="text-black w-5 h-5" />
          </div>
          <span className="text-xl font-bold hidden lg:block">NEXUS</span>
        </div>

        <nav className="flex-1 space-y-2">
          <NavItem 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')}
            icon={<Bell className="w-5 h-5" />}
            label="Dashboard"
          />
          <NavItem 
            active={activeTab === 'contacts'} 
            onClick={() => setActiveTab('contacts')}
            icon={<Users className="w-5 h-5" />}
            label="Contacts"
          />
          <NavItem 
            active={activeTab === 'settings'} 
            onClick={() => setActiveTab('settings')}
            icon={<SettingsIcon className="w-5 h-5" />}
            label="Settings"
          />
        </nav>

        <button 
          onClick={signOut}
          className="flex items-center gap-3 px-4 py-3 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-all mt-auto"
        >
          <LogOut className="w-5 h-5" />
          <span className="hidden lg:block">Sign Out</span>
        </button>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8">
        <header className="flex justify-between items-center mb-12">
          <div>
            <h2 className="text-3xl font-bold">
              {activeTab === 'dashboard' && 'Outreach Recommendations'}
              {activeTab === 'contacts' && 'Your Network'}
              {activeTab === 'settings' && 'Settings'}
            </h2>
            <p className="text-zinc-500 mt-1">
              {activeTab === 'dashboard' && `You have ${contacts.filter(c => c.nextOutreachAt && isBefore(parseISO(c.nextOutreachAt), new Date())).length} contacts to reach out to.`}
              {activeTab === 'contacts' && `Managing ${contacts.length} connections.`}
              {activeTab === 'settings' && 'Configure your CRM experience.'}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={handleSyncAll}
              disabled={isSyncing}
              className={cn(
                "flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-sm font-bold hover:bg-zinc-800 transition-all",
                isSyncing && "opacity-50 cursor-not-allowed"
              )}
            >
              <RefreshCw className={cn("w-4 h-4", isSyncing && "animate-spin")} />
              {isSyncing ? 'Syncing...' : 'Sync All'}
            </button>
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input 
                type="text" 
                placeholder="Search contacts..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 rounded-xl py-2 pl-10 pr-4 w-64 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
            {user && (
              <ImportContacts 
                userId={user.uid} 
                onComplete={() => {}} 
              />
            )}
            <button 
              onClick={() => setIsAddContactOpen(true)}
              className="p-3 bg-emerald-500 text-black rounded-xl hover:bg-emerald-400 transition-colors"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-8"
            >
              <div className="lg:col-span-2 space-y-6">
                <h3 className="text-lg font-semibold text-zinc-400 uppercase tracking-wider">Priority Outreach</h3>
                <div className="space-y-4">
                  {filteredContacts
                    .filter(c => c.nextOutreachAt && isBefore(parseISO(c.nextOutreachAt), new Date()))
                    .map(contact => (
                      <ContactCard 
                        key={contact.id} 
                        contact={contact} 
                        onClick={() => setSelectedContact(contact)} 
                        getReachOutReason={getReachOutReason}
                      />
                    ))}
                  {contacts.length === 0 && (
                    <div className="p-12 border border-dashed border-zinc-800 rounded-3xl text-center text-zinc-500">
                      No outreach needed right now. Add some contacts to get started!
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-zinc-400 uppercase tracking-wider">Recent Activity</h3>
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-6 space-y-6">
                  {allInteractions.map(interaction => {
                    const contact = contacts.find(c => c.id === interaction.contactId);
                    return (
                      <ActivityItem 
                        key={interaction.id}
                        icon={
                          interaction.type === 'gmail' ? <Mail className="w-4 h-4 text-emerald-400" /> :
                          interaction.type === 'linkedin' ? <Linkedin className="w-4 h-4 text-blue-400" /> :
                          interaction.type === 'instagram' ? <Instagram className="w-4 h-4 text-pink-400" /> :
                          <MessageSquare className="w-4 h-4 text-zinc-400" />
                        }
                        title={contact ? `${contact.firstName} ${contact.lastName}` : 'Unknown'}
                        desc={interaction.content}
                        time={format(parseISO(interaction.timestamp), 'HH:mm')}
                      />
                    );
                  })}
                  {allInteractions.length === 0 && (
                    <div className="text-zinc-500 text-sm italic text-center py-4">No recent activity.</div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'contacts' && (
            <motion.div 
              key="contacts"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Level A" count={contacts.filter(c => c.level === 'A').length} color="text-emerald-500" />
                <StatCard label="Level B" count={contacts.filter(c => c.level === 'B').length} color="text-blue-500" />
                <StatCard label="Level C" count={contacts.filter(c => c.level === 'C').length} color="text-amber-500" />
                <StatCard label="Level D" count={contacts.filter(c => c.level === 'D').length} color="text-zinc-500" />
              </div>

              <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-900/80">
                      <th className="px-6 py-4 font-semibold text-zinc-400 uppercase text-xs tracking-widest">Name</th>
                      <th className="px-6 py-4 font-semibold text-zinc-400 uppercase text-xs tracking-widest">Level</th>
                      <th className="px-6 py-4 font-semibold text-zinc-400 uppercase text-xs tracking-widest">Last Interaction</th>
                      <th className="px-6 py-4 font-semibold text-zinc-400 uppercase text-xs tracking-widest">Next Outreach</th>
                      <th className="px-6 py-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContacts.map(contact => (
                      <tr 
                        key={contact.id} 
                        className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors cursor-pointer"
                        onClick={() => setSelectedContact(contact)}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center text-lg font-bold text-zinc-400">
                              {(contact.firstName?.[0] || contact.lastName?.[0] || contact.email?.[0] || '?').toUpperCase()}
                            </div>
                            <div>
                              <div className="font-semibold flex items-center gap-2">
                                {contact.firstName || contact.lastName ? `${contact.firstName} ${contact.lastName}`.trim() : contact.email || 'Unnamed Contact'}
                                {contact.socialScanStatus === 'scanning' && (
                                  <RefreshCw className="w-3 h-3 text-emerald-500 animate-spin" />
                                )}
                                {contact.socialScanStatus === 'completed' && (
                                  <Check className="w-3 h-3 text-emerald-500" />
                                )}
                              </div>
                              <div className="text-xs text-zinc-500">{getReachOutReason(contact)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={cn(
                            "px-2 py-1 rounded-md text-xs font-bold",
                            contact.level === 'A' && "bg-emerald-500/10 text-emerald-500",
                            contact.level === 'B' && "bg-blue-500/10 text-blue-500",
                            contact.level === 'C' && "bg-amber-500/10 text-amber-500",
                            contact.level === 'D' && "bg-zinc-500/10 text-zinc-500",
                          )}>
                            Level {contact.level}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-zinc-400 text-sm">
                          {contact.lastInteractionAt ? format(parseISO(contact.lastInteractionAt), 'MMM d, yyyy') : 'Never'}
                        </td>
                        <td className="px-6 py-4 text-zinc-400 text-sm">
                          {contact.nextOutreachAt ? format(parseISO(contact.nextOutreachAt), 'MMM d, yyyy') : 'TBD'}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <ChevronRight className="w-5 h-5 text-zinc-600 inline" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-4xl space-y-12"
            >
              <section className="space-y-6">
                <h3 className="text-xl font-bold">Outreach Frequencies</h3>
                <p className="text-zinc-500">Define how often you want to reach out to each contact level.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {(['A', 'B', 'C', 'D'] as ContactLevel[]).map(level => (
                    <FrequencyInput 
                      key={level}
                      label={`Level ${level}`} 
                      value={settings?.frequencies[level] || 30} 
                      onChange={(val) => handleUpdateFrequency(level, val)}
                    />
                  ))}
                </div>
              </section>

              <section className="space-y-6">
                <h3 className="text-xl font-bold">RSS Feeds</h3>
                <form onSubmit={handleAddRss} className="flex gap-3">
                  <input 
                    type="url" 
                    value={newRssUrl}
                    onChange={e => setNewRssUrl(e.target.value)}
                    placeholder="Enter RSS feed URL..."
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 focus:outline-none focus:border-emerald-500"
                  />
                  <button type="submit" className="px-6 bg-white text-black font-bold rounded-xl hover:bg-zinc-200 transition-colors">
                    Add Feed
                  </button>
                </form>
                <div className="space-y-2">
                  {rssFeeds.map((url, i) => (
                    <div key={i} className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl flex justify-between items-center">
                      <span className="text-sm text-zinc-400 truncate max-w-md">{url}</span>
                      <button className="text-zinc-600 hover:text-red-500 transition-colors">
                        <Plus className="w-4 h-4 rotate-45" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-6">
                <h3 className="text-xl font-bold">Integrations</h3>
                {!apiKeySelected && (
                  <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <AlertCircle className="w-5 h-5 text-amber-500" />
                      <div>
                        <div className="font-bold text-amber-500">API Key Required</div>
                        <div className="text-xs text-amber-500/70">Select a Google Cloud project with billing enabled to use AI features.</div>
                      </div>
                    </div>
                    <button 
                      onClick={handleOpenKeySelector}
                      className="px-4 py-2 bg-amber-500 text-black text-xs font-bold rounded-xl hover:bg-amber-400 transition-colors"
                    >
                      Select Key
                    </button>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <IntegrationRow 
                    icon={<Mail className="w-5 h-5 text-emerald-400" />}
                    name="Gmail"
                    status={integrationStatuses.gmail ? 'Connected' : 'Disconnected'}
                    onToggle={() => handleConnect('Gmail')}
                  />
                  <IntegrationRow 
                    icon={<Linkedin className="w-5 h-5 text-blue-400" />}
                    name="LinkedIn"
                    status={integrationStatuses.linkedin ? 'Connected' : 'Disconnected'}
                    onToggle={() => handleConnect('LinkedIn')}
                  />
                  <IntegrationRow 
                    icon={<Instagram className="w-5 h-5 text-pink-400" />}
                    name="Instagram"
                    status={integrationStatuses.instagram ? 'Connected' : 'Disconnected'}
                    onToggle={() => handleConnect('Instagram')}
                  />
                  <IntegrationRow 
                    icon={<MessageCircle className="w-5 h-5 text-blue-500" />}
                    name="iMessage"
                    status={integrationStatuses.imessage ? 'Connected' : 'Disconnected'}
                    onToggle={() => handleConnect('iMessage')}
                  />
                  <IntegrationRow 
                    icon={<MessageCircle className="w-5 h-5 text-green-500" />}
                    name="WhatsApp"
                    status={integrationStatuses.whatsapp ? 'Connected' : 'Disconnected'}
                    onToggle={() => handleConnect('WhatsApp')}
                  />
                  <IntegrationRow 
                    icon={<Rss className="w-5 h-5 text-orange-400" />}
                    name="RSS Feeds"
                    status={integrationStatuses.rss ? 'Connected' : 'Disconnected'}
                    onToggle={() => {}}
                  />
                </div>
              </section>

              <section className="space-y-6 pt-12 border-t border-zinc-800/50">
                <div className="flex items-center gap-2 text-red-500">
                  <AlertCircle className="w-5 h-5" />
                  <h3 className="text-xl font-bold">Danger Zone</h3>
                </div>
                <div className="p-6 bg-red-500/5 border border-red-500/10 rounded-3xl">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <div className="font-bold text-red-500">Delete All Contacts</div>
                      <div className="text-sm text-zinc-500">This will permanently remove all contacts and their interaction history. This action cannot be undone.</div>
                    </div>
                    <button 
                      onClick={() => setShowDeleteAllConfirm(true)}
                      className="px-6 py-3 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 transition-colors whitespace-nowrap"
                    >
                      Delete All Data
                    </button>
                  </div>
                </div>
              </section>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Contact Detail Modal */}
      <AnimatePresence>
        {selectedContact && (
          <div className="fixed inset-0 z-50 flex items-center justify-end">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedContact(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="relative w-full max-w-2xl h-full bg-[#0F0F0F] border-l border-zinc-800 p-8 overflow-y-auto"
            >
              <button 
                onClick={() => setSelectedContact(null)}
                className="absolute top-8 right-8 p-2 hover:bg-zinc-800 rounded-full transition-colors"
              >
                <Plus className="w-6 h-6 rotate-45" />
              </button>

              <div className="space-y-12">
                <header className="flex items-center gap-6">
                  <div className="w-24 h-24 bg-zinc-800 rounded-3xl flex items-center justify-center text-4xl font-bold text-zinc-400">
                    {(selectedContact.firstName?.[0] || selectedContact.lastName?.[0] || selectedContact.email?.[0] || '?').toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <h2 className="text-4xl font-bold truncate">
                          {selectedContact.firstName || selectedContact.lastName ? `${selectedContact.firstName} ${selectedContact.lastName}`.trim() : selectedContact.email || 'Unnamed Contact'}
                        </h2>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="px-2 py-1 bg-emerald-500/10 text-emerald-500 rounded text-[10px] font-bold uppercase tracking-widest">
                            Level {selectedContact.level}
                          </span>
                          {selectedContact.tags.map(tag => (
                            <span key={tag} className="px-2 py-1 bg-zinc-800 text-zinc-500 rounded text-[10px] font-bold uppercase tracking-widest">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 shrink-0">
                        <button 
                          onClick={() => {
                            setEditContact(selectedContact);
                            setIsEditing(true);
                          }}
                          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm font-bold transition-colors whitespace-nowrap"
                        >
                          Edit Contact
                        </button>
                        <button 
                          onClick={() => handleTriggerOutreach(selectedContact.id, "Simulated: New Job on LinkedIn")}
                          className="px-4 py-2 bg-zinc-900 text-zinc-400 text-xs font-bold rounded-xl hover:bg-zinc-800 transition-colors border border-zinc-800 whitespace-nowrap"
                        >
                          Simulate Job Change
                        </button>
                      </div>
                    </div>
                    
                    <div className="flex gap-4 mt-6 items-center">
                      <SocialIcon icon={<Mail className="w-4 h-4" />} active={!!selectedContact.email} href={selectedContact.email ? `mailto:${selectedContact.email}` : undefined} />
                      <SocialIcon icon={<Linkedin className="w-4 h-4" />} active={!!selectedContact.linkedinUrl} href={selectedContact.linkedinUrl} />
                      <SocialIcon icon={<Instagram className="w-4 h-4" />} active={!!selectedContact.instagramHandle} href={selectedContact.instagramHandle ? `https://instagram.com/${selectedContact.instagramHandle}` : undefined} />
                      <SocialIcon icon={<Phone className="w-4 h-4" />} active={!!selectedContact.phone} href={selectedContact.phone ? `tel:${selectedContact.phone}` : undefined} />
                      
                      <button 
                        onClick={handleManualScan}
                        disabled={selectedContact.socialScanStatus === 'scanning'}
                        className="ml-4 text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-emerald-500 transition-colors flex items-center gap-1"
                      >
                        <RefreshCw className={cn("w-3 h-3", selectedContact.socialScanStatus === 'scanning' && "animate-spin")} />
                        {selectedContact.socialScanStatus === 'scanning' ? 'Scanning...' : 'Scan Socials'}
                      </button>
                    </div>
                  </div>
                </header>

                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <div className="text-xs text-zinc-500 uppercase tracking-widest font-bold">Email Address</div>
                      <div className="text-lg font-medium text-zinc-300">{selectedContact.email || 'Not provided'}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-zinc-500 uppercase tracking-widest font-bold">Phone Number</div>
                      <div className="text-lg font-medium text-zinc-300">{selectedContact.phone || 'Not provided'}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-zinc-500 uppercase tracking-widest font-bold">LinkedIn</div>
                      <div className="text-lg font-medium text-zinc-300 truncate max-w-[200px]">
                        {selectedContact.linkedinUrl ? (
                          <a href={selectedContact.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                            {selectedContact.linkedinUrl.split('/').pop()}
                          </a>
                        ) : 'Not connected'}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-zinc-500 uppercase tracking-widest font-bold">Instagram</div>
                      <div className="text-lg font-medium text-zinc-300">
                        {selectedContact.instagramHandle ? (
                          <a href={`https://instagram.com/${selectedContact.instagramHandle}`} target="_blank" rel="noopener noreferrer" className="text-pink-400 hover:underline">
                            @{selectedContact.instagramHandle}
                          </a>
                        ) : 'Not connected'}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <div className="text-xs text-zinc-500 uppercase tracking-widest font-bold">Contact Level</div>
                      <div className="text-xl font-semibold">Level {selectedContact.level}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-zinc-500 uppercase tracking-widest font-bold">Next Outreach</div>
                      <div className="text-xl font-semibold text-emerald-500">
                        {selectedContact.nextOutreachAt ? format(parseISO(selectedContact.nextOutreachAt), 'MMMM d, yyyy') : 'TBD'}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-zinc-500 uppercase tracking-widest font-bold">Reach Out Reason</div>
                      <div className="text-lg font-medium text-emerald-400">{getReachOutReason(selectedContact)}</div>
                    </div>
                  </div>
                </div>

                <section className="space-y-6">
                  <div className="flex justify-between items-center border-b border-zinc-800 pb-4">
                    <h3 className="text-xl font-bold flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-emerald-500" />
                      AI Outreach Strategy
                    </h3>
                    <button 
                      onClick={handleGetAIInsights}
                      disabled={isAnalyzing}
                      className={cn(
                        "px-4 py-2 bg-emerald-500 text-black text-xs font-bold rounded-xl hover:bg-emerald-400 transition-all flex items-center gap-2",
                        isAnalyzing && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {isAnalyzing ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          Analyzing History...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3 h-3" />
                          Generate Insights
                        </>
                      )}
                    </button>
                  </div>

                  <AnimatePresence mode="wait">
                    {aiInsights ? (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="grid grid-cols-1 md:grid-cols-2 gap-4"
                      >
                        <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-2xl space-y-3">
                          <div className="flex items-center gap-2 text-emerald-500">
                            <Clock className="w-4 h-4" />
                            <span className="text-xs font-bold uppercase tracking-widest">Optimal Timing</span>
                          </div>
                          <p className="text-sm text-zinc-200 font-medium">{aiInsights.optimalTime}</p>
                        </div>
                        <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-2xl space-y-3">
                          <div className="flex items-center gap-2 text-blue-500">
                            <MessageCircle className="w-4 h-4" />
                            <span className="text-xs font-bold uppercase tracking-widest">Recommended Tone</span>
                          </div>
                          <p className="text-sm text-zinc-200 font-medium">{aiInsights.approach}</p>
                        </div>
                        <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-2xl space-y-3 md:col-span-2">
                          <div className="flex items-center gap-2 text-amber-500">
                            <Lightbulb className="w-4 h-4" />
                            <span className="text-xs font-bold uppercase tracking-widest">Suggested Content</span>
                          </div>
                          <p className="text-sm text-zinc-200 leading-relaxed mb-2">{aiInsights.suggestedContent}</p>
                          <div className="pt-3 border-t border-zinc-800/50">
                            <p className="text-[10px] text-zinc-500 uppercase font-bold mb-1">Reasoning</p>
                            <p className="text-xs text-zinc-500 italic">{aiInsights.reasoning}</p>
                          </div>
                        </div>
                      </motion.div>
                    ) : !isAnalyzing && (
                      <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-2xl p-8 text-center">
                        <p className="text-zinc-500 text-sm">Click "Generate Insights" to let AI analyze your interaction history and suggest the perfect outreach strategy.</p>
                      </div>
                    )}
                  </AnimatePresence>
                </section>

                <section className="space-y-6">
                  <div className="flex justify-between items-center border-b border-zinc-800 pb-4">
                    <div className="flex items-center gap-4">
                      <h3 className="text-xl font-bold">Interaction Timeline</h3>
                      <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1">
                        <Filter className="w-3 h-3 text-zinc-500" />
                        <select className="bg-transparent text-[10px] font-bold uppercase tracking-wider text-zinc-400 focus:outline-none">
                          <option>All Channels</option>
                          <option>Gmail</option>
                          <option>LinkedIn</option>
                          <option>Instagram</option>
                          <option>WhatsApp</option>
                          <option>iMessage</option>
                          <option>Manual</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => handleSyncInteractions(selectedContact)}
                        disabled={isSyncing}
                        className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-bold transition-colors"
                      >
                        <RefreshCw className={cn("w-3 h-3", isSyncing && "animate-spin")} />
                        {isSyncing ? 'Syncing...' : 'Sync Now'}
                      </button>
                      <button 
                        onClick={() => {
                          const content = prompt("Log a manual interaction:");
                          if (content) handleLogInteraction('manual', content);
                        }}
                        className="bg-emerald-500 text-black text-sm font-bold hover:bg-emerald-400 transition-colors flex items-center gap-2 px-3 py-1.5 rounded-lg"
                      >
                        <Plus className="w-4 h-4" /> Log Manual
                      </button>
                    </div>
                  </div>
                  <div className="relative space-y-0">
                    <div className="absolute left-[19px] top-2 bottom-2 w-px bg-zinc-800" />
                    {interactions.map((interaction, idx) => (
                      <HistoryItem 
                        key={interaction.id}
                        type={interaction.type}
                        title={
                          interaction.type === 'manual' ? 'Manual Note' : 
                          interaction.type === 'rss' ? 'RSS Update' :
                          interaction.type.toUpperCase()
                        }
                        content={interaction.content}
                        date={format(parseISO(interaction.timestamp), 'MMM d, yyyy')}
                        isLast={idx === interactions.length - 1}
                      />
                    ))}
                    {interactions.length === 0 && (
                      <div className="text-zinc-500 text-center py-12 italic border border-dashed border-zinc-800 rounded-2xl">
                        No interactions found. Click "Sync All" to aggregate data from connected platforms.
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Contact Modal */}
      <AnimatePresence>
        {isAddContactOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddContactOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-lg bg-[#0F0F0F] border border-zinc-800 rounded-3xl p-8 shadow-2xl"
            >
              <h3 className="text-2xl font-bold mb-6">Add New Contact</h3>
              <form onSubmit={handleAddContact} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-500 uppercase font-bold">First Name</label>
                    <input 
                      required
                      type="text" 
                      value={newContact.firstName}
                      onChange={e => setNewContact({...newContact, firstName: e.target.value})}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 focus:outline-none focus:border-emerald-500"
                      placeholder="John"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-500 uppercase font-bold">Last Name</label>
                    <input 
                      type="text" 
                      value={newContact.lastName}
                      onChange={e => setNewContact({...newContact, lastName: e.target.value})}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 focus:outline-none focus:border-emerald-500"
                      placeholder="Doe"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-500 uppercase font-bold">Email</label>
                    <input 
                      type="email" 
                      value={newContact.email}
                      onChange={e => setNewContact({...newContact, email: e.target.value})}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 focus:outline-none focus:border-emerald-500"
                      placeholder="john@example.com"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-500 uppercase font-bold">Level</label>
                    <select 
                      value={newContact.level}
                      onChange={e => setNewContact({...newContact, level: e.target.value as ContactLevel})}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 focus:outline-none focus:border-emerald-500"
                    >
                      <option value="A">Level A (Weekly)</option>
                      <option value="B">Level B (Monthly)</option>
                      <option value="C">Level C (Quarterly)</option>
                      <option value="D">Level D (Semi-Annual)</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-500 uppercase font-bold">LinkedIn URL</label>
                    <input 
                      type="url" 
                      value={newContact.linkedinUrl}
                      onChange={e => setNewContact({...newContact, linkedinUrl: e.target.value})}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 focus:outline-none focus:border-emerald-500"
                      placeholder="https://linkedin.com/in/username"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-500 uppercase font-bold">Instagram Handle</label>
                    <input 
                      type="text" 
                      value={newContact.instagramHandle}
                      onChange={e => setNewContact({...newContact, instagramHandle: e.target.value})}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 focus:outline-none focus:border-emerald-500"
                      placeholder="@username"
                    />
                  </div>
                </div>
                <div className="flex gap-4 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsAddContactOpen(false)}
                    className="flex-1 py-3 bg-zinc-800 text-white font-bold rounded-xl hover:bg-zinc-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-3 bg-emerald-500 text-black font-bold rounded-xl hover:bg-emerald-400 transition-colors"
                  >
                    Save Contact
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
        {/* Edit Contact Modal */}
        {isEditing && editContact && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsEditing(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-lg bg-[#0F0F0F] border border-zinc-800 rounded-3xl p-8 shadow-2xl"
            >
              <h3 className="text-2xl font-bold mb-6">Edit Contact</h3>
              <form onSubmit={handleUpdateContact} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-500 uppercase font-bold">First Name</label>
                    <input 
                      required
                      type="text" 
                      value={editContact.firstName}
                      onChange={e => setEditContact({...editContact, firstName: e.target.value})}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-500 uppercase font-bold">Last Name</label>
                    <input 
                      type="text" 
                      value={editContact.lastName}
                      onChange={e => setEditContact({...editContact, lastName: e.target.value})}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-500 uppercase font-bold">Email</label>
                    <input 
                      type="email" 
                      value={editContact.email}
                      onChange={e => setEditContact({...editContact, email: e.target.value})}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-500 uppercase font-bold">Phone</label>
                    <input 
                      type="tel" 
                      value={editContact.phone}
                      onChange={e => setEditContact({...editContact, phone: e.target.value})}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-500 uppercase font-bold">LinkedIn URL</label>
                    <input 
                      type="url" 
                      value={editContact.linkedinUrl}
                      onChange={e => setEditContact({...editContact, linkedinUrl: e.target.value})}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-500 uppercase font-bold">Instagram Handle</label>
                    <input 
                      type="text" 
                      value={editContact.instagramHandle}
                      onChange={e => setEditContact({...editContact, instagramHandle: e.target.value})}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-zinc-500 uppercase font-bold">Level</label>
                  <select 
                    value={editContact.level}
                    onChange={e => setEditContact({...editContact, level: e.target.value as ContactLevel})}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="A">Level A (Weekly)</option>
                    <option value="B">Level B (Monthly)</option>
                    <option value="C">Level C (Quarterly)</option>
                    <option value="D">Level D (Semi-Annual)</option>
                  </select>
                </div>
                <div className="flex gap-4 pt-4">
                  <button 
                    type="button"
                    onClick={() => setShowDeleteContactConfirm(editContact.id)}
                    className="p-3 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500/20 transition-colors"
                    title="Delete Contact"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                  <button 
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="flex-1 py-3 bg-zinc-800 text-white font-bold rounded-xl hover:bg-zinc-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-3 bg-emerald-500 text-black font-bold rounded-xl hover:bg-emerald-400 transition-colors"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmation Modals */}
      <AnimatePresence>
        {(showDeleteAllConfirm || showDeleteContactConfirm) && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setShowDeleteAllConfirm(false);
                setShowDeleteContactConfirm(null);
              }}
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-md bg-[#0F0F0F] border border-zinc-800 rounded-3xl p-8 shadow-2xl text-center"
            >
              <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Trash2 className="w-8 h-8 text-red-500" />
              </div>
              <h3 className="text-2xl font-bold mb-2">Are you sure?</h3>
              <p className="text-zinc-500 mb-8">
                {showDeleteAllConfirm 
                  ? "This will permanently delete all contacts and interaction history. This action cannot be undone."
                  : "This will permanently delete this contact. This action cannot be undone."}
              </p>
              <div className="flex gap-4">
                <button 
                  onClick={() => {
                    setShowDeleteAllConfirm(false);
                    setShowDeleteContactConfirm(null);
                  }}
                  className="flex-1 py-3 bg-zinc-800 text-white font-bold rounded-xl hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    if (showDeleteAllConfirm) handleDeleteAllContacts();
                    else if (showDeleteContactConfirm) handleDeleteContact(showDeleteContactConfirm);
                  }}
                  className="flex-1 py-3 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 transition-colors"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavItem({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string, key?: any }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
        active ? "bg-emerald-500 text-black font-bold" : "text-zinc-400 hover:text-white hover:bg-zinc-800"
      )}
    >
      {icon}
      <span className="hidden lg:block">{label}</span>
    </button>
  );
}

function ContactCard({ contact, onClick, getReachOutReason }: { contact: Contact, onClick: () => void, getReachOutReason: (c: Contact) => string, key?: any }) {
  const reason = getReachOutReason(contact);
  const isDue = contact.nextOutreachAt && isBefore(parseISO(contact.nextOutreachAt), new Date());
  
  return (
    <div 
      onClick={onClick}
      className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl hover:border-emerald-500/50 transition-all cursor-pointer group"
    >
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-zinc-800 rounded-2xl flex items-center justify-center text-xl font-bold group-hover:bg-emerald-500 group-hover:text-black transition-colors text-zinc-400">
            {(contact.firstName?.[0] || contact.lastName?.[0] || contact.email?.[0] || '?').toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-bold text-lg truncate">
              {contact.firstName || contact.lastName ? `${contact.firstName} ${contact.lastName}`.trim() : contact.email || 'Unnamed Contact'}
            </h4>
            <div className="text-zinc-500 text-sm truncate">
              Level {contact.level} • <span className={cn("font-semibold", isDue ? "text-emerald-500" : "text-zinc-400")}>{reason}</span>
            </div>
          </div>
        </div>
        <div className="text-right">
          {isDue && <div className="text-emerald-500 text-sm font-bold">Due Today</div>}
          <div className="text-zinc-500 text-xs">Last: {contact.lastInteractionAt ? format(parseISO(contact.lastInteractionAt), 'MMM d') : 'Never'}</div>
        </div>
      </div>
      <div className="flex gap-2">
        {contact.tags.map(tag => (
          <span key={tag} className="px-2 py-1 bg-zinc-800 rounded-md text-[10px] text-zinc-400 uppercase font-bold tracking-wider">
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

function ActivityItem({ icon, title, desc, time }: { icon: React.ReactNode, title: string, desc: string, time: string, key?: any }) {
  return (
    <div className="flex gap-4">
      <div className="w-8 h-8 bg-zinc-800 rounded-lg flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-start">
          <h5 className="font-bold text-sm truncate">{title}</h5>
          <span className="text-[10px] text-zinc-600 uppercase font-bold">{time}</span>
        </div>
        <p className="text-xs text-zinc-500 line-clamp-1">{desc}</p>
      </div>
    </div>
  );
}

function StatCard({ label, count, color }: { label: string, count: number, color: string }) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-3xl">
      <div className="text-zinc-500 text-xs font-bold uppercase tracking-widest mb-2">{label}</div>
      <div className={cn("text-4xl font-bold", color)}>{count}</div>
    </div>
  );
}

function FrequencyInput({ label, value, onChange }: { label: string, value: number, onChange: (val: number) => void, key?: any }) {
  return (
    <div className="space-y-2">
      <label className="text-xs text-zinc-500 uppercase tracking-widest font-bold">{label}</label>
      <div className="flex items-center gap-3">
        <input 
          type="number" 
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value) || 0)}
          className="bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 w-full focus:outline-none focus:border-emerald-500 transition-colors"
        />
        <span className="text-zinc-500 font-medium">days</span>
      </div>
    </div>
  );
}

function IntegrationRow({ icon, name, status, onToggle }: { icon: React.ReactNode, name: string, status: string, onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between p-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center">
          {icon}
        </div>
        <div>
          <div className="font-bold">{name}</div>
          <div className={cn("text-xs font-bold uppercase tracking-widest", status === 'Connected' ? 'text-emerald-500' : 'text-zinc-600')}>
            {status}
          </div>
        </div>
      </div>
      <button 
        onClick={onToggle}
        className={cn(
          "px-4 py-2 rounded-xl text-xs font-bold transition-colors",
          status === 'Connected' ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700' : 'bg-white text-black hover:bg-zinc-200'
        )}
      >
        {status === 'Connected' ? 'Disconnect' : 'Connect'}
      </button>
    </div>
  );
}

function SocialIcon({ icon, active, href }: { icon: React.ReactNode, active?: boolean, href?: string }) {
  const content = (
    <div className={cn(
      "w-10 h-10 border rounded-xl flex items-center justify-center transition-all",
      active 
        ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-500" 
        : "bg-zinc-900/50 border-zinc-800/50 text-zinc-700 grayscale"
    )}>
      {icon}
    </div>
  );

  if (href && active) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="hover:scale-110 transition-transform">
        {content}
      </a>
    );
  }

  return content;
}

function HistoryItem({ type, title, content, date, isLast }: { type: InteractionType, title: string, content: string, date: string, key?: any, isLast?: boolean }) {
  const Icon = {
    gmail: Mail,
    linkedin: Linkedin,
    whatsapp: MessageSquare,
    imessage: MessageSquare,
    instagram: Instagram,
    manual: Calendar,
    rss: Rss
  }[type];

  const color = {
    gmail: 'text-emerald-400',
    linkedin: 'text-blue-400',
    whatsapp: 'text-green-400',
    imessage: 'text-blue-500',
    instagram: 'text-pink-400',
    manual: 'text-zinc-400',
    rss: 'text-orange-400'
  }[type];

  return (
    <div className="flex gap-6 relative group">
      <div className="flex flex-col items-center shrink-0">
        <div className={cn(
          "w-10 h-10 bg-[#0F0F0F] border border-zinc-800 rounded-xl flex items-center justify-center z-10 group-hover:border-zinc-600 transition-colors", 
          color
        )}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div className={cn("pb-10 flex-1", isLast && "pb-0")}>
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-3">
            <h4 className="font-bold text-zinc-200">{title}</h4>
            <span className={cn(
              "text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800",
              color
            )}>
              {type}
            </span>
          </div>
          <span className="text-xs text-zinc-600 font-bold uppercase">{date}</span>
        </div>
        <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-2xl p-4 group-hover:bg-zinc-900/50 transition-colors">
          <p className="text-zinc-400 text-sm leading-relaxed">{content}</p>
        </div>
      </div>
    </div>
  );
}
