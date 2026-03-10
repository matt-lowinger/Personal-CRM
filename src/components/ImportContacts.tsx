import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import { Upload, FileText, Check, AlertCircle, Loader2 } from 'lucide-react';
import { collection, doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { cn, handleFirestoreError, OperationType } from '../lib/utils';
import { findSocialProfiles } from '../services/socialService';

interface ImportContactsProps {
  userId: string;
  onComplete: () => void;
}

export const ImportContacts: React.FC<ImportContactsProps> = ({ userId, onComplete }) => {
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setError(null);
    setSuccess(null);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const data = results.data as any[];
          console.log(`Parsed ${data.length} rows from CSV`);
          
          let batch = writeBatch(db);
          let count = 0;
          const contactsToScan: { id: string; name: string; email: string }[] = [];

          for (const row of data) {
            let firstName = (row['First Name'] || row['Given Name'] || '').trim();
            let lastName = (row['Last Name'] || row['Family Name'] || row['Surname'] || '').trim();
            let fullName = '';

            if (!firstName && !lastName) {
              fullName = (row['Name'] || row['Display Name'] || row['Full Name'] || '').trim();
              if (!fullName) continue;
              const parts = fullName.split(/\s+/);
              firstName = parts[0] || '';
              lastName = parts.slice(1).join(' ') || '';
            } else {
              fullName = `${firstName} ${lastName}`.trim();
            }

            const email = row['E-mail 1 - Value'] || row['Email'] || row['Email Address'] || row['E-mail Address'] || '';
            const phone = row['Phone 1 - Value'] || row['Phone'] || row['Mobile Number'] || row['Phone Number'] || '';
            
            const contactRef = doc(collection(db, 'contacts'));
            const contactData = {
              firstName,
              lastName,
              email,
              phone,
              level: 'B' as const,
              tags: [],
              ownerId: userId,
              socialScanStatus: 'pending',
              nextOutreachAt: new Date().toISOString(),
              createdAt: new Date().toISOString()
            };

            batch.set(contactRef, contactData);
            contactsToScan.push({ id: contactRef.id, name: fullName, email });
            count++;

            if (count % 500 === 0) {
              try {
                await batch.commit();
              } catch (err) {
                handleFirestoreError(err, OperationType.WRITE, 'contacts/batch');
              }
              batch = writeBatch(db);
            }
          }

          if (count > 0 && count % 500 !== 0) {
            try {
              await batch.commit();
            } catch (err) {
              handleFirestoreError(err, OperationType.WRITE, 'contacts/batch');
            }
          }

          setSuccess(count);
          
          // Process social scans in small batches to avoid rate limits
          const processScans = async () => {
            // Only scan the first 20 for now to avoid overwhelming the API in one go
            // In a real app, this would be a background job or a throttled queue
            const limitedScans = contactsToScan.slice(0, 20);
            for (const item of limitedScans) {
              try {
                const social = await findSocialProfiles(item.name, item.email);
                if (social.linkedinUrl || social.instagramHandle) {
                  const contactRef = doc(db, 'contacts', item.id);
                  const updateBatch = writeBatch(db);
                  updateBatch.update(contactRef, {
                    linkedinUrl: social.linkedinUrl || null,
                    instagramHandle: social.instagramHandle || null,
                    socialScanStatus: 'completed'
                  });
                  try {
                    await updateBatch.commit();
                  } catch (err) {
                    handleFirestoreError(err, OperationType.UPDATE, `contacts/${item.id}`);
                  }
                } else {
                  const contactRef = doc(db, 'contacts', item.id);
                  const updateBatch = writeBatch(db);
                  updateBatch.update(contactRef, { socialScanStatus: 'failed' });
                  try {
                    await updateBatch.commit();
                  } catch (err) {
                    handleFirestoreError(err, OperationType.UPDATE, `contacts/${item.id}`);
                  }
                }
                // Small delay between scans
                await new Promise(resolve => setTimeout(resolve, 1000));
              } catch (err) {
                console.error(`Failed to scan ${item.name}:`, err);
              }
            }
          };

          processScans().catch(console.error);

          setTimeout(() => {
            onComplete();
            setSuccess(null);
          }, 3000);
        } catch (err) {
          console.error('Import error:', err);
          setError('Failed to import contacts. Please check the file format.');
        } finally {
          setIsImporting(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      },
      error: (err) => {
        setError('Error parsing CSV: ' + err.message);
        setIsImporting(false);
      }
    });
  };

  return (
    <div className="relative">
      <input
        type="file"
        accept=".csv"
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileUpload}
      />
      
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={isImporting}
        className={cn(
          "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all",
          isImporting 
            ? "bg-zinc-800 text-zinc-500 cursor-not-allowed" 
            : "bg-zinc-900 border border-zinc-800 text-white hover:bg-zinc-800"
        )}
      >
        {isImporting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : success ? (
          <Check className="w-4 h-4 text-emerald-500" />
        ) : (
          <Upload className="w-4 h-4" />
        )}
        {isImporting ? 'Importing...' : success ? `Imported ${success}` : 'Bulk Import (CSV)'}
      </button>

      {error && (
        <div className="absolute top-full mt-2 right-0 w-64 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-xs flex items-start gap-2 z-50">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
