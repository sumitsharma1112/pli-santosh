
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Calculator, Download, Info, Mic, MicOff, Volume2, GraduationCap, FileSpreadsheet, AlertCircle } from 'lucide-react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { MONTHLY_PREMIUM_TABLE, HALF_YEARLY_PREMIUM_TABLE, YEARLY_PREMIUM_TABLE, BONUS_RATE } from './constants';
import { CalculationResult, Frequency } from './types';

// Audio Constants
const SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

// Encoding/Decoding Helpers
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const App: React.FC = () => {
  // Application State
  const [dob, setDob] = useState<string>('');
  const [sumAssured, setSumAssured] = useState<number | ''>('');
  const [maturityAge, setMaturityAge] = useState<number | ''>('');
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  
  // UI State
  const [activeField, setActiveField] = useState<string | null>(null);
  const [isAssistantActive, setIsAssistantActive] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState<string>('Assistant ready. Say "Hi Gopal"');
  
  // Audio Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionRef = useRef<any>(null);

  // Derived Values
  const currentPliAge = useMemo(() => {
    if (!dob) return 0;
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
  }, [dob]);

  const validMaturityOptions = useMemo(() => {
    const all = [35, 40, 45, 50, 55, 58, 60];
    if (!currentPliAge) return all;
    return all.filter(age => age >= currentPliAge + 5);
  }, [currentPliAge]);

  // Sync Maturity Age when DOB changes
  useEffect(() => {
    if (dob && validMaturityOptions.length > 0) {
      if (maturityAge === '' || !validMaturityOptions.includes(Number(maturityAge))) {
        setMaturityAge(validMaturityOptions[validMaturityOptions.length - 1]);
      }
    }
  }, [validMaturityOptions, dob, maturityAge]);

  // Provide current state to the session instruction
  const stateRef = useRef({ dob, sumAssured, maturityAge, currentPliAge, validMaturityOptions });
  useEffect(() => {
    stateRef.current = { dob, sumAssured, maturityAge, currentPliAge, validMaturityOptions };
  }, [dob, sumAssured, maturityAge, currentPliAge, validMaturityOptions]);

  // Premium Calculation Logic
  const result = useMemo((): CalculationResult | null => {
    if (!dob || !sumAssured || !maturityAge || currentPliAge < 19 || currentPliAge > 55) return null;
    const saNumber = Number(sumAssured);
    const matAgeNum = Number(maturityAge);
    if (saNumber <= 0 || saNumber % 5000 !== 0) return null;

    const term = matAgeNum - currentPliAge;
    if (term < 5) return null;

    let table = MONTHLY_PREMIUM_TABLE;
    let freqMultiplier = 12;
    let rebateMultiplier = 1; 
    
    if (frequency === 'half') {
      table = HALF_YEARLY_PREMIUM_TABLE;
      freqMultiplier = 2;
      rebateMultiplier = 6; 
    } else if (frequency === 'yearly') {
      table = YEARLY_PREMIUM_TABLE;
      freqMultiplier = 1;
      rebateMultiplier = 12;
    }

    const ageData = table[currentPliAge];
    if (!ageData || !ageData[matAgeNum]) return null;

    const rateFor5000 = ageData[matAgeNum];
    const basePremium = Math.round((saNumber / 5000) * rateFor5000);
    const saRebatePerMonth = Math.floor(saNumber / 20000);
    const totalRebateForFrequency = saRebatePerMonth * rebateMultiplier;
    const finalPremium = Math.max(0, basePremium - totalRebateForFrequency);

    const bonusPerYear = (saNumber / 1000) * BONUS_RATE;
    const totalBonus = bonusPerYear * term;
    const maturityAmount = saNumber + totalBonus;
    const totalPremiumPaid = finalPremium * freqMultiplier * term;

    return {
      pliAge: currentPliAge, term, sumAssured: saNumber, maturityAge: matAgeNum, frequency,
      paymentText: frequency === 'half' ? 'Half Yearly' : frequency === 'yearly' ? 'Yearly' : 'Monthly',
      basePremium, saRebatePerMonth, totalRebateForFrequency, finalPremium,
      bonusRate: BONUS_RATE, bonusPerYear, totalBonus, maturityAmount, totalPremiumPaid,
      returns: maturityAmount - totalPremiumPaid, dob
    };
  }, [dob, sumAssured, maturityAge, frequency, currentPliAge]);

  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(val);

  const exportPDF = () => {
    if (!result) return;
    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    const contentWidth = pageWidth - (margin * 2);
    const pdfCurrency = (v: number) => 'Rs. ' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(v);

    doc.setFillColor(37, 99, 235);
    doc.roundedRect(margin, 20, contentWidth, 55, 6, 6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.text(`ESTIMATED PREMIUM (${result.paymentText.toUpperCase()})`, margin + 10, 32);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(32);
    doc.text(pdfCurrency(result.finalPremium), margin + 10, 50);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Total Maturity Value', margin + 10, 65);
    doc.text('Policy Term', pageWidth - margin - 10, 65, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(pdfCurrency(result.maturityAmount), margin + 10, 71);
    doc.text(`${result.term} Years`, pageWidth - margin - 10, 71, { align: 'right' });
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(14);
    doc.text('FINANCIAL SUMMARY', margin, 95);

    let currentY = 108;
    const drawRow = (label: string, value: string, isGreen: boolean = false, isBold: boolean = false) => {
      doc.setFont('helvetica', isBold ? 'bold' : 'normal');
      doc.setFontSize(10);
      doc.setTextColor(isGreen ? 22 : 15, isGreen ? 163 : 23, isGreen ? 74 : 42);
      doc.text(label, margin, currentY);
      doc.text(value, pageWidth - margin, currentY, { align: 'right' });
      doc.setDrawColor(241, 245, 249);
      doc.line(margin, currentY + 3, pageWidth - margin, currentY + 3);
      currentY += 10;
    };

    drawRow('Base Premium', pdfCurrency(result.basePremium));
    drawRow('SA Rebate Applied', `- ${pdfCurrency(result.totalRebateForFrequency)}`, true);
    drawRow('Total Premium Paid', pdfCurrency(result.totalPremiumPaid));
    drawRow('Total Bonus Accrued', pdfCurrency(result.totalBonus));
    currentY += 4;
    drawRow('NET MATURITY BENEFIT', pdfCurrency(result.maturityAmount), false, true);
    doc.save(`PLI_Santosh_Quote.pdf`);
  };

  const tools: { functionDeclarations: FunctionDeclaration[] }[] = [{
    functionDeclarations: [
      {
        name: 'set_date_of_birth',
        description: 'Update user Date of Birth. Age must be 19-55. Format: YYYY-MM-DD.',
        parameters: {
          type: Type.OBJECT,
          properties: { date: { type: Type.STRING, description: 'YYYY-MM-DD birth date' } },
          required: ['date']
        }
      },
      {
        name: 'set_sum_assured',
        description: 'Update the Sum Assured. Should be multiple of 5000.',
        parameters: {
          type: Type.OBJECT,
          properties: { amount: { type: Type.NUMBER, description: 'Rupee amount' } },
          required: ['amount']
        }
      },
      {
        name: 'set_maturity_age',
        description: 'Update Maturity Age choice. Choice must be at least 5 years after current age.',
        parameters: {
          type: Type.OBJECT,
          properties: { age: { type: Type.NUMBER, description: '35, 40, 45, 50, 55, 58, 60' } },
          required: ['age']
        }
      }
    ]
  }];

  const stopAssistant = useCallback(() => {
    if (sessionRef.current) sessionRef.current.close();
    if (audioContextRef.current) audioContextRef.current.close();
    if (outputAudioContextRef.current) outputAudioContextRef.current.close();
    setIsAssistantActive(false);
    setAssistantStatus('Assistant ready. Say "Hi Gopal"');
    sessionRef.current = null;
    audioContextRef.current = null;
    outputAudioContextRef.current = null;
    setActiveField(null);
  }, []);

  const triggerHighlight = (field: string) => {
    setActiveField(field);
    setTimeout(() => setActiveField(null), 3000);
  };

  const startAssistant = async () => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      setIsAssistantActive(true);
      setAssistantStatus('Initializing...');
      
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: OUTPUT_SAMPLE_RATE });
      
      if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
      if (outputAudioContextRef.current.state === 'suspended') await outputAudioContextRef.current.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: SAMPLE_RATE } 
      });

      setAssistantStatus('Say "Hi Gopal"');
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
          tools,
          systemInstruction: `You are Gopal, a professional PLI Santosh Assistant.
STRICT PERSONA:
- Use natural Indian mixed conversation style (Hindi/English).
- UI labels and screen outputs are strictly English.

WAKE WORD:
- Respond ONLY after the user says "Hi Gopal" or similar.
- Response: "Namaste! Main Gopal hoon. Chaliye aapki details fill karte hain. Sabse pehle aapki Date of Birth kya hai?"

STRICT SEQUENTIAL DATA ENTRY:
1. ASK FOR 'Date of Birth' FIRST. Entry age MUST be 19 to 55 years.
   - If age is outside 19-55 (e.g. 1907 or 2010), explain the limit and ask for correct date.
2. ONLY AFTER DOB is set, ASK FOR 'Sum Assured'.
3. ONLY AFTER SA is set, ASK FOR 'Maturity Age'.
   - Maturity age choice must be at least 5 years away from current age.
   - Valid options for current user: ${stateRef.current.validMaturityOptions.join(', ')}.

CURRENT STATE:
- DOB: ${stateRef.current.dob || 'Empty'}
- SA: ${stateRef.current.sumAssured || 'Empty'}
- Maturity: ${stateRef.current.maturityAge || 'Empty'}
- Current Age: ${stateRef.current.currentPliAge}

CALL TOOLS AS SOON AS DATA IS RECEIVED. If a tool call fails, inform the user why.`
        },
        callbacks: {
          onopen: () => {
            const scriptProcessor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                int16[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
              }
              sessionPromise.then(s => s.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } }));
            };
            audioContextRef.current!.createMediaStreamSource(stream).connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current!.destination);
          },
          onmessage: async (m: LiveServerMessage) => {
            const audioData = m.serverContent?.modelTurn?.parts.find(p => p.inlineData)?.inlineData?.data;
            if (audioData) {
              setAssistantStatus('Gopal is speaking...');
              const buffer = await decodeAudioData(decode(audioData), outputAudioContextRef.current!, OUTPUT_SAMPLE_RATE, 1);
              const source = outputAudioContextRef.current!.createBufferSource();
              source.buffer = buffer;
              source.connect(outputAudioContextRef.current!.destination);
              const playTime = Math.max(nextStartTimeRef.current, outputAudioContextRef.current!.currentTime);
              source.start(playTime);
              nextStartTimeRef.current = playTime + buffer.duration;
              source.onended = () => { if (isAssistantActive) setAssistantStatus('Gopal is listening...'); };
            }
            if (m.toolCall) {
              const responses = [];
              for (const fc of m.toolCall.functionCalls) {
                let statusMsg = "Updated successfully.";
                if (fc.name === 'set_date_of_birth') {
                  const bDate = new Date(fc.args.date as string);
                  const age = new Date().getFullYear() - bDate.getFullYear();
                  if (age < 19 || age > 55) {
                    statusMsg = "Error: Eligibility age is 19 to 55 years.";
                  } else {
                    setDob(fc.args.date as string);
                    triggerHighlight('dob');
                  }
                } else if (fc.name === 'set_sum_assured') {
                  setSumAssured(Number(fc.args.amount));
                  triggerHighlight('sa');
                } else if (fc.name === 'set_maturity_age') {
                  const choice = Number(fc.args.age);
                  if (!stateRef.current.validMaturityOptions.includes(choice)) {
                    statusMsg = "Error: Maturity must be at least 5 years away.";
                  } else {
                    setMaturityAge(choice);
                    triggerHighlight('maturity');
                  }
                }
                responses.push({ id: fc.id, name: fc.name, response: { result: statusMsg } });
              }
              if (responses.length > 0) {
                sessionPromise.then(s => s.sendToolResponse({ functionResponses: responses }));
              }
            }
          },
          onerror: (e) => { setAssistantStatus('Error happened.'); },
          onclose: () => stopAssistant()
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e) { stopAssistant(); }
  };

  const isAgeValid = currentPliAge >= 19 && currentPliAge <= 55;

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 font-sans">
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-black text-slate-900 flex items-center justify-center gap-3">
          <Calculator className="text-blue-600 w-10 h-10" />
          PLI Santosh
        </h1>
        <p className="text-slate-500 font-medium mt-1 uppercase tracking-widest text-xs">Professional Premium Calculator</p>
      </header>

      {/* Assistant Status */}
      <div className={`mb-10 p-8 rounded-[2.5rem] transition-all duration-500 flex flex-col md:flex-row items-center gap-10 ${
        isAssistantActive ? 'bg-indigo-600 shadow-2xl text-white scale-[1.01]' : 'bg-white border border-slate-200 shadow-sm'
      }`}>
        <div className="flex flex-col items-center gap-4">
          <button onClick={isAssistantActive ? stopAssistant : startAssistant}
            className={`w-24 h-24 rounded-full flex items-center justify-center transition-all shadow-2xl relative group ${
              isAssistantActive ? 'bg-white text-indigo-600' : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}>
            {isAssistantActive ? <MicOff size={40} /> : <Mic size={40} />}
            {isAssistantActive && <span className="absolute -inset-2 rounded-full border-4 border-white/20 animate-ping"></span>}
          </button>
          <span className={`text-[10px] font-black uppercase tracking-widest ${isAssistantActive ? 'text-indigo-100' : 'text-slate-400'}`}>
            {isAssistantActive ? 'Voice Mode' : 'Wake Gopal'}
          </span>
        </div>
        <div className="flex-1 w-full text-center md:text-left">
          <h2 className="text-2xl font-black tracking-tight">{isAssistantActive ? 'Gopal is assisting you' : 'Meet Assistant Gopal'}</h2>
          <p className={`text-sm font-bold ${isAssistantActive ? 'text-indigo-100' : 'text-slate-500'}`}>{assistantStatus}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <div className="bg-white p-10 rounded-[3rem] shadow-sm border border-slate-200">
          <h3 className="text-xl font-black text-slate-800 mb-8 flex items-center gap-3">
            <GraduationCap size={24} className="text-blue-500" />
            Policy Parameters
          </h3>
          <div className="space-y-6">
            <div className={`p-4 rounded-3xl transition-all duration-500 ${activeField === 'dob' ? 'bg-blue-100 ring-4 ring-blue-500 shadow-lg' : 'bg-slate-50'}`}>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Date of Birth</label>
              <input type="date" value={dob} onChange={(e) => setDob(e.target.value)}
                className="w-full bg-transparent font-black text-slate-700 outline-none" />
              {dob && !isAgeValid && (
                <div className="flex items-center gap-1 mt-2 text-red-500 text-[10px] font-bold">
                  <AlertCircle size={12} /> Age limit: 19 to 55 years.
                </div>
              )}
            </div>
            <div className={`p-4 rounded-3xl transition-all duration-500 ${activeField === 'sa' ? 'bg-blue-100 ring-4 ring-blue-500 shadow-lg' : 'bg-slate-50'}`}>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Sum Assured (₹)</label>
              <input type="number" step="5000" value={sumAssured} 
                onChange={(e) => setSumAssured(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="Enter Sum Assured"
                className="w-full bg-transparent font-black text-slate-700 outline-none" />
            </div>
            <div className={`p-4 rounded-3xl transition-all duration-500 ${activeField === 'maturity' ? 'bg-blue-100 ring-4 ring-blue-500 shadow-lg' : 'bg-slate-50'}`}>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Maturity Age</label>
              <select value={maturityAge} onChange={(e) => setMaturityAge(Number(e.target.value))}
                className="w-full bg-transparent font-black text-slate-700 outline-none appearance-none">
                <option value="">Select Maturity Choice</option>
                {validMaturityOptions.map(age => <option key={age} value={age}>{age} Years</option>)}
              </select>
            </div>
            <div className="p-4 bg-slate-50 rounded-3xl">
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Payment Frequency</label>
              <div className="flex gap-2">
                {(['monthly', 'half', 'yearly'] as Frequency[]).map(f => (
                  <button key={f} onClick={() => setFrequency(f)}
                    className={`flex-1 py-3 text-[10px] font-black uppercase rounded-xl transition-all ${
                      frequency === f ? 'bg-blue-600 text-white shadow-lg' : 'bg-white text-slate-500 border border-slate-200'
                    }`}>{f}</button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-8">
          {result ? (
            <>
              <div className="bg-blue-600 p-10 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden">
                <div className="absolute top-1/2 -right-4 -translate-y-1/2 opacity-20 pointer-events-none">
                   <FileSpreadsheet size={180} />
                </div>
                <div className="relative z-10">
                  <p className="text-blue-100 text-[10px] font-black uppercase tracking-widest">ESTIMATED PREMIUM ({result.paymentText.toUpperCase()})</p>
                  <h3 className="text-7xl font-black mt-4 tracking-tighter">{formatCurrency(result.finalPremium)}</h3>
                  <div className="mt-12 flex justify-between items-end border-t border-white/20 pt-6">
                    <div>
                      <p className="text-blue-100 text-[10px] font-bold uppercase tracking-widest">Maturity Value</p>
                      <p className="text-2xl font-black">{formatCurrency(result.maturityAmount)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-blue-100 text-[10px] font-bold uppercase tracking-widest">Term</p>
                      <p className="text-2xl font-black">{result.term} Years</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-slate-200">
                <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-8 flex items-center gap-3">
                  <Info size={16} className="text-blue-600" /> Breakdown
                </h4>
                <div className="space-y-6">
                  <div className="flex justify-between items-center text-sm">
                    <span className="font-bold text-slate-500">Base Premium</span>
                    <span className="font-black text-slate-800">{formatCurrency(result.basePremium)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="font-bold text-green-600">Sum Assured Rebate</span>
                    <span className="font-black text-green-600">- {formatCurrency(result.totalRebateForFrequency)}</span>
                  </div>
                  <div className="h-px bg-slate-100 my-2"></div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-black text-slate-900 uppercase">NET MATURITY VALUE</span>
                    <span className="text-xl font-black text-blue-600">{formatCurrency(result.maturityAmount)}</span>
                  </div>
                </div>
                <div className="mt-12">
                   <button onClick={exportPDF} 
                    className="w-full bg-slate-900 text-white py-5 rounded-[1.5rem] font-black uppercase tracking-widest text-xs shadow-xl hover:bg-slate-800 transition-all flex items-center justify-center gap-3">
                    <Download size={18} /> Export PDF
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="h-full min-h-[400px] bg-slate-100/50 border-4 border-dashed border-slate-200 rounded-[3rem] flex flex-col items-center justify-center p-12 text-center">
              <div className="bg-white p-6 rounded-full shadow-lg mb-6">
                <Volume2 size={40} className="text-blue-300 animate-pulse" />
              </div>
              <h3 className="text-xl font-black text-slate-800 uppercase tracking-widest">Awaiting Inputs</h3>
              <p className="text-slate-500 text-sm mt-2 max-w-xs font-bold leading-relaxed">Update the policy parameters or say "Hi Gopal" to start the automated setup.</p>
            </div>
          )}
        </div>
      </div>
      
      <footer className="mt-20 text-center text-slate-400 text-[10px] font-black uppercase tracking-[0.4em] pb-10">
        <p>© 2025 PLI Gopal Smart Assistant • Professional Planner</p>
      </footer>
    </div>
  );
};

export default App;
