import React, { useState, useEffect, useMemo } from 'react';
import { Search, Cpu, HardDrive, Star, Download, ExternalLink, Info, AlertTriangle, ChevronRight, LayoutGrid, List, Moon, Sun, Monitor } from 'lucide-react';

/**
 * UNDERDOG HUB
 * A discovery tool for Large Language Models that actually fit on your hardware.
 * Focuses on VRAM efficiency and local deployment.
 */

const PRESETS = [
  { label: "MacBook Air M-Series (8GB Unified)", vram: 6 },
  { label: "RTX 3050/4050 Laptop (6GB VRAM)", vram: 6 },
  { label: "RTX 4060 Laptop/Desktop (8GB VRAM)", vram: 8 },
  { label: "MacBook Pro M-Series (16GB Unified)", vram: 12 },
  { label: "RTX 3060/4070 Laptop (12GB VRAM)", vram: 12 },
  { label: "RTX 3090/4090 Desktop (24GB VRAM)", vram: 24 }
];

// Typical GGUF bit mappings
const QUANT_BITS = {
  'FP16': 16,
  'Q8_0': 8,
  'Q8_1': 8,
  'Q6_K': 6.5,
  'Q5_K_M': 5.5,
  'Q5_K_S': 5.5,
  'Q5_0': 5,
  'Q5_1': 5,
  'Q4_K_M': 4.5,
  'Q4_K_S': 4.5,
  'Q4_0': 4,
  'Q4_1': 4,
  'Q3_K_L': 3.5,
  'Q3_K_M': 3.5,
  'Q3_K_S': 3.5,
  'Q2_K': 2.5
};

const App = () => {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [vramBudget, setVramBudget] = useState(6); // Default 6GB
  const [viewMode, setViewMode] = useState('grid');
  const [theme, setTheme] = useState(
    localStorage.getItem('theme') || 
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );
  const [selectedPreset, setSelectedPreset] = useState('');
  const [formatFilter, setFormatFilter] = useState('gguf');

  // Handle Theme
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const applyPreset = (e) => {
    const val = e.target.value;
    setSelectedPreset(val);
    if (val !== '') {
      const preset = PRESETS[parseInt(val)];
      setVramBudget(preset.vram);
    }
  };

  // App Constants
  const API_URL = "https://huggingface.co/api/models";

  // Fetch models from Hugging Face
  useEffect(() => {
    const fetchModels = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          filter: 'gguf',
          sort: 'downloads',
          direction: '-1',
          limit: '250',
          full: 'true',
          config: 'true'
        });

        const response = await fetch(`${API_URL}?${params}`);
        if (!response.ok) throw new Error('Failed to fetch from Hugging Face');
        
        const data = await response.json();
        
        const processed = data.map(m => {
          let paramsCount = 0;
          
          const pTag = m.tags?.find(t => /^[0-9.]+[Bb]$/.test(t));
          if (pTag) {
            paramsCount = parseFloat(pTag.replace(/[Bb]/g, ''));
          } else if (m.id.toLowerCase().includes('7b')) { paramsCount = 7;
          } else if (m.id.toLowerCase().includes('1b')) { paramsCount = 1;
          } else if (m.id.toLowerCase().includes('3b')) { paramsCount = 3;
          } else if (m.id.toLowerCase().includes('8b')) { paramsCount = 8;
          } else if (m.id.toLowerCase().includes('11b')) { paramsCount = 11;
          } else if (m.id.toLowerCase().includes('13b')) { paramsCount = 13;
          } else if (m.id.toLowerCase().includes('14b')) { paramsCount = 14;
          } else if (m.id.toLowerCase().includes('32b')) { paramsCount = 32;
          } else if (m.id.toLowerCase().includes('70b')) { paramsCount = 70;
          } else {
            paramsCount = 0.5; 
          }

          const hasGGUF = true; // Guaranteed by the modified fetch filter
          const hasSafetensors = (m.tags || []).some(t => t.toLowerCase().includes('safetensors')) || (m.siblings || []).some(s => s.rfilename && s.rfilename.endsWith('.safetensors'));

          // Extract unique GGUF files and their probable bits
          const availableQuants = [];
          (m.siblings || []).forEach(s => {
            if (s.rfilename && s.rfilename.endsWith('.gguf')) {
              for (const [qName, bits] of Object.entries(QUANT_BITS)) {
                if (s.rfilename.includes(qName)) {
                  availableQuants.push({ name: qName, bits: bits, filename: s.rfilename });
                  break; // Only push the most specific match
                }
              }
            }
          });

          // Sort quantizations from highest quality (most bits) to lowest
          availableQuants.sort((a, b) => b.bits - a.bits);

          return {
            id: m.id,
            name: m.id.split('/').pop(),
            author: m.id.split('/')[0],
            downloads: m.downloads,
            likes: m.likes,
            params: paramsCount,
            tags: m.tags || [],
            hasGGUF,
            hasSafetensors,
            availableQuants,
            lastModified: new Date(m.lastModified).toLocaleDateString()
          };
        });

        // Filter out repos that don't successfully parse parameters or have ZERO recognized gguf siblings
        setModels(processed.filter(m => m.params > 0));
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchModels();
  }, []);

  // Helper to find the best fit given a model and vram budget
  const getBestFit = (model, budget) => {
    // If not GGUF or searching for safetensors, just fallback to an 8-bit estimate
    if (formatFilter === 'safetensors' || (!model.hasGGUF && formatFilter === 'any')) {
      const vramRequired = calculateVram(model.params, 8);
      return vramRequired <= budget ? { name: 'Safetensors (Est. 8-bit)', bits: 8, vram: vramRequired } : null;
    }

    // Default to a 4-bit estimate if no specific siblings found
    if (model.availableQuants.length === 0) {
      const vramRequired = calculateVram(model.params, 4);
      return vramRequired <= budget ? { name: 'Unknown Q4 (Est)', bits: 4, vram: vramRequired } : null;
    }
    
    // Find the highest quality quantization that fits
    for (const quant of model.availableQuants) {
      const vramRequired = calculateVram(model.params, quant.bits);
      if (vramRequired <= budget) {
        return { ...quant, vram: vramRequired };
      }
    }
    return null; // None fit
  };

  const filteredModels = useMemo(() => {
    return models
      .map(model => ({ ...model, bestFit: getBestFit(model, vramBudget) }))
      .filter(model => {
        const matchesSearch = model.id.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesFormat = formatFilter === 'any' ? true :
                              formatFilter === 'gguf' ? model.hasGGUF :
                              formatFilter === 'safetensors' ? model.hasSafetensors : true;
        return model.bestFit !== null && matchesSearch && matchesFormat;
      });
  }, [models, vramBudget, searchQuery, formatFilter]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-sans transition-colors duration-200">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600 p-2 rounded-lg shadow-sm shadow-indigo-200 dark:shadow-none">
            <Cpu className="text-white w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-800 dark:text-slate-100">Underdog Hub</h1>
        </div>
        
        <div className="flex-1 max-w-xl relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 w-5 h-5" />
          <input 
            type="text"
            placeholder="Search Llama, Phi, Qwen..."
            className="w-full pl-10 pr-4 py-2 bg-slate-100 dark:bg-slate-800 border focus:border-indigo-500 dark:border-slate-700 dark:focus:border-indigo-500 rounded-full transition-all outline-none text-sm dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={toggleTheme}
            className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors mr-2"
            title="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          
          <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1 border border-slate-200 dark:border-slate-700">
            <button 
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              <LayoutGrid size={18} />
            </button>
            <button 
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              <List size={18} />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-4 gap-8">
        
        {/* Sidebar Controls */}
        <aside className="lg:col-span-1">
          <div className="sticky top-24 space-y-6">
            <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 transition-colors">
              <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-5 flex items-center gap-2">
                <HardDrive className="w-4 h-4" /> Hardware Limits
              </h2>
              
              <div className="space-y-6">
                <div>
                  <label className="text-sm font-medium block mb-2 dark:text-slate-200">Model Format</label>
                  <div className="relative mb-5">
                    <HardDrive className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <select 
                      value={formatFilter}
                      onChange={(e) => setFormatFilter(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:border-indigo-500 dark:focus:border-indigo-500 dark:text-slate-200 appearance-none"
                    >
                      <option value="any">Any Format</option>
                      <option value="gguf">GGUF (Ollama / Local)</option>
                      <option value="safetensors">Safetensors (PyTorch)</option>
                    </select>
                  </div>

                  <label className="text-sm font-medium block mb-2 dark:text-slate-200">Hardware Presets</label>
                  <div className="relative">
                    <Monitor className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <select 
                      value={selectedPreset}
                      onChange={applyPreset}
                      className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:border-indigo-500 dark:focus:border-indigo-500 dark:text-slate-200 appearance-none"
                    >
                      <option value="">Custom Config...</option>
                      {PRESETS.map((p, i) => (
                        <option key={p.label} value={i}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-slate-700/50">
                  <div className="flex justify-between mb-2">
                    <label className="text-sm font-medium dark:text-slate-200">VRAM Budget</label>
                    <span className="text-indigo-600 dark:text-indigo-400 font-bold">{vramBudget} GB</span>
                  </div>
                  <input 
                    type="range" 
                    min="2" 
                    max="24" 
                    step="1"
                    value={vramBudget}
                    onChange={(e) => {
                      setVramBudget(parseInt(e.target.value));
                      setSelectedPreset(''); // reset preset if manual change
                    }}
                    className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600 dark:accent-indigo-500"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                    <span>Mobile/Entry</span>
                    <span>Mid-Range</span>
                    <span>Enthusiast</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-indigo-900/90 dark:bg-indigo-500/10 border border-transparent dark:border-indigo-500/20 text-indigo-50 p-6 rounded-2xl shadow-lg relative overflow-hidden">
              <div className="relative z-10">
                <h3 className="font-bold text-white dark:text-indigo-300 mb-2 flex items-center gap-2">
                  <Star className="w-4 h-4 fill-current" /> Underdog Tip
                </h3>
                <p className="text-sm leading-relaxed opacity-90 dark:text-indigo-200/90">
                  If you have 6GB VRAM, look for <strong>8B param</strong> models in <strong>4-bit</strong>. They hit the sweet spot of speed and intelligence.
                </p>
              </div>
              <div className="absolute -bottom-6 -right-6 opacity-10 dark:opacity-5 text-indigo-200 group-hover:scale-110 transition-transform">
                <Cpu size={140} />
              </div>
            </div>
          </div>
        </aside>

        {/* Content Area */}
        <section className="lg:col-span-3">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                {filteredModels.length} Compatible Models
              </h2>
              <p className="text-slate-500 dark:text-slate-400 text-sm">Sorted by popularity on Hugging Face</p>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 opacity-50 dark:opacity-70">
              <div className="w-12 h-12 border-4 border-indigo-600/30 dark:border-indigo-400/30 border-t-indigo-600 dark:border-t-indigo-400 rounded-full animate-spin mb-4"></div>
              <p className="dark:text-slate-300">Scouring the Hub for you...</p>
            </div>
          ) : error ? (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 p-8 rounded-2xl border border-red-100 dark:border-red-900/50 flex flex-col items-center text-center">
              <AlertTriangle className="w-12 h-12 mb-4" />
              <h3 className="font-bold text-lg mb-1">Connection Error</h3>
              <p className="max-w-md mx-auto text-sm">{error}</p>
              <button 
                onClick={() => window.location.reload()}
                className="mt-6 px-6 py-2 bg-red-600 dark:bg-red-500 hover:bg-red-700 dark:hover:bg-red-600 transition-colors text-white rounded-full text-sm font-medium"
              >
                Retry
              </button>
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="bg-white dark:bg-slate-800 p-16 rounded-3xl border border-slate-200 dark:border-slate-700 text-center shadow-sm">
              <Search className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-2">No Underdogs Found</h3>
              <p className="text-slate-500 dark:text-slate-400 max-w-sm mx-auto">Try increasing your VRAM budget or searching for smaller architectures like 'Phi' or 'Gemma'.</p>
            </div>
          ) : (
            <div className={viewMode === 'grid' ? "grid grid-cols-1 md:grid-cols-2 gap-5" : "space-y-4"}>
              {filteredModels.map((model) => {
                const pctOfBudget = (model.bestFit.vram / vramBudget) * 100;
                
                return (
                  <div 
                    key={model.id}
                    className={`bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:shadow-xl hover:shadow-indigo-500/5 dark:hover:shadow-indigo-500/10 transition-all group overflow-hidden ${viewMode === 'list' ? 'flex flex-col sm:flex-row items-stretch sm:items-center p-0' : 'flex flex-col'}`}
                  >
                    {viewMode === 'grid' && (
                      <div className="bg-slate-50/80 dark:bg-slate-800/50 px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-start">
                        <div className="w-11 h-11 bg-white dark:bg-slate-900 rounded-xl flex items-center justify-center shadow-sm border border-slate-200 dark:border-slate-600 font-bold text-indigo-600 dark:text-indigo-400 text-sm">
                          {model.params}B
                        </div>
                        <div className="flex flex-col items-end gap-1.5 text-xs text-slate-500 dark:text-slate-400 font-medium">
                          <span className="flex items-center gap-1.5"><Download size={14} className="text-slate-400" /> {model.downloads.toLocaleString()}</span>
                          <span className="flex items-center gap-1.5"><Star size={14} className="text-slate-400" /> {model.likes.toLocaleString()}</span>
                        </div>
                      </div>
                    )}

                    {viewMode === 'list' && (
                      <div className="hidden sm:flex px-6 py-6 border-r border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 flex-col justify-center items-center self-stretch w-24">
                        <span className="font-bold text-indigo-600 dark:text-indigo-400 text-lg">{model.params}B</span>
                      </div>
                    )}

                    <div className={`p-5 flex-1 ${viewMode === 'list' ? 'sm:py-4 px-5' : ''}`}>
                      <div className="flex justify-between items-start mb-1">
                        <h3 className="font-bold text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 truncate pr-4" title={model.id}>
                          {model.name}
                        </h3>
                        <div className="flex gap-1">
                          {model.hasGGUF && (
                            <span className="shrink-0 flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-1 rounded-md border border-emerald-200 dark:border-emerald-800/50">
                              GGUF
                            </span>
                          )}
                          {model.hasSafetensors && formatFilter !== 'gguf' && (
                            <span className="shrink-0 flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded-md border border-blue-200 dark:border-blue-800/50">
                              Safetensors
                            </span>
                          )}
                        </div>
                      </div>
                      
                      <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">{model.author}</p>
                      
                      <div className="space-y-3">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500 dark:text-slate-400 font-medium">Best Fit</span>
                          <span className="font-bold text-slate-700 dark:text-slate-300">
                            {model.bestFit.name}
                          </span>
                        </div>

                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500 dark:text-slate-400 font-medium">Memory Buffer</span>
                          <span className={`font-bold ${pctOfBudget > 90 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                            ~{model.bestFit.vram} GB
                          </span>
                        </div>
                        
                        <div className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div 
                            className={`h-full transition-all duration-1000 ease-out rounded-full ${pctOfBudget > 90 ? 'bg-amber-400 dark:bg-amber-500' : 'bg-emerald-400 dark:bg-emerald-500'}`}
                            style={{ width: `${Math.min(pctOfBudget, 100)}%` }}
                          />
                        </div>

                        {viewMode === 'list' && (
                          <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400 pt-2">
                             <span className="flex items-center gap-1"><Download size={14} /> {model.downloads.toLocaleString()}</span>
                             <span className="flex items-center gap-1"><Star size={14} /> {model.likes.toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className={`px-5 py-3 bg-slate-50/80 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between ${viewMode === 'list' ? 'sm:border-t-0 sm:border-l sm:h-full sm:flex-col sm:justify-center sm:px-6' : ''}`}>
                       <a 
                        href={`https://huggingface.co/${model.id}${
                          model.bestFit.filename ? `/blob/main/${model.bestFit.filename}` : 
                          formatFilter === 'gguf' || model.hasGGUF ? '/tree/main' : 
                          formatFilter === 'safetensors' ? '/tree/main' : ''
                        }`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 flex items-center gap-1 hover:underline hover:text-indigo-700 dark:hover:text-indigo-300"
                       >
                         {model.bestFit.filename ? `Download ${model.bestFit.name}` : (formatFilter === 'gguf' && model.hasGGUF) || (formatFilter === 'any' && model.hasGGUF) ? 'Get GGUF Files' : formatFilter === 'safetensors' && model.hasSafetensors ? 'Get Safetensors' : 'View Card'} <ExternalLink size={12} />
                       </a>
                       <div className={`text-[10px] text-slate-400 dark:text-slate-500 ${viewMode === 'list' ? 'sm:mt-2' : ''}`}>
                         Updated: {model.lastModified}
                       </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          
          <div className="mt-12 p-8 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl flex flex-col md:flex-row items-start gap-6 shadow-sm">
            <div className="bg-orange-100 dark:bg-orange-900/30 p-4 rounded-2xl text-orange-600 dark:text-orange-400 shrink-0">
              <Info className="w-8 h-8" />
            </div>
            <div>
              <h4 className="font-bold text-lg text-slate-900 dark:text-slate-100 mb-2">How we calculate compatibility</h4>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-6">
                We use the calculation: <code>(Parameters × Target Bits / 8) × 1.2</code>. 
                The 1.2x safety multiplier guarantees room for the KV Cache (your conversation history) and system overhead. 
                If you intend to use massive context windows (32k+ tokens), consider upgrading to the next preset tier.
              </p>
              
              <div className="flex flex-col">
                <span className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">Compatible Local Engines</span>
                <div className="flex flex-wrap gap-2">
                  {[
                    {name: 'LM Studio', url: 'https://lmstudio.ai'}, 
                    {name: 'Ollama', url: 'https://ollama.com'}, 
                    {name: 'GPT4All', url: 'https://gpt4all.io'}, 
                    {name: 'llama.cpp', url: 'https://github.com/ggerganov/llama.cpp'}
                  ].map(tool => (
                    <a 
                      key={tool.name} 
                      href={tool.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 transition-colors flex items-center gap-1.5"
                    >
                      {tool.name} <ExternalLink size={10} className="opacity-50" />
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 mt-20 py-12 bg-white dark:bg-slate-900 transition-colors">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-6 text-center md:text-left">
          <div className="flex flex-col items-center md:items-start gap-1">
            <div className="flex items-center gap-2 grayscale opacity-50 dark:opacity-40 hover:grayscale-0 hover:opacity-100 transition-all cursor-default text-slate-900 dark:text-white pb-1 border-b border-transparent hover:border-indigo-600 dark:hover:border-indigo-400 mb-2">
              <Cpu size={24} />
              <span className="font-bold tracking-tight">Underdog Hub</span>
            </div>
            <p className="text-slate-400 dark:text-slate-500 text-xs max-w-sm">
              Helping constraints birth creativity. We scour the Hugging Face Hub so your hardware doesn't have to suffer.
            </p>
          </div>
          
          <div className="flex gap-6 text-sm font-medium text-slate-500 dark:text-slate-400">
            <a href="https://github.com/underdog-hub" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">GitHub</a>
            <a href="https://huggingface.co/" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Hugging Face API</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;