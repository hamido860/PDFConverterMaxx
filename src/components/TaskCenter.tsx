import React, { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, CheckCircle2, Circle, AlertCircle, Sparkles, Copy, Database, Component, FileText, Layers, Activity } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

interface TaskCenterProps {
  supabaseUrl: string;
  supabaseKey: string;
  isSupabaseEnabled: boolean;
}

export function TaskCenter({ supabaseUrl, supabaseKey, isSupabaseEnabled }: TaskCenterProps) {
  const [treeData, setTreeData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [activeNode, setActiveNode] = useState<any>(null);
  
  // Tasks specifically generated for activeNode
  const [nodeTasks, setNodeTasks] = useState<any[]>([]);

  useEffect(() => {
    if (isSupabaseEnabled && supabaseUrl && supabaseKey) {
      fetchTree();
    }
  }, [isSupabaseEnabled, supabaseUrl, supabaseKey]);

  const fetchTree = async () => {
    setIsLoading(true);
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      // Fetch core hierarchy
      const [
        { data: curricula }, 
        { data: cycles }, 
        { data: grades }, 
        { data: gradeSubjs },
        { data: subjects },
        { data: bacSections },
        { data: bacTracks },
        { data: trackSubjs }
      ] = await Promise.all([
        supabase.from('curricula').select('*'),
        supabase.from('cycles').select('*'),
        supabase.from('grades').select('*'),
        supabase.from('grade_subjects').select('*'),
        supabase.from('subjects').select('*'),
        supabase.from('bac_sections').select('*'),
        supabase.from('bac_tracks').select('*'),
        supabase.from('bac_track_subjects').select('*'),
      ]);

      const subjMap = new Map((subjects || []).map(s => [s.id, s]));
      const trackSubjLinks = trackSubjs || [];
      
      // Build Curricula
      const tree = (curricula || []).map(curr => {
        const currCycles = (cycles || []).filter(c => c.curriculum_id === curr.id);
        
        return {
          id: curr.id,
          type: 'curriculum',
          name: curr.name,
          children: currCycles.map(cyc => {
            const cycGrades = (grades || []).filter(g => g.cycle_id === cyc.id);
            return {
               id: cyc.id,
               type: 'cycle',
               name: cyc.name,
               children: cycGrades.map(g => {
                  const nodeNameLower = g.name.toLowerCase();
                  const isBac = nodeNameLower.includes('bac') || g.name.includes('البكالوريا');
                  
                  // For Bac grades, we might want to show Sections -> Tracks
                  if (isBac) {
                    return {
                      id: g.id,
                      type: 'grade',
                      name: g.name,
                      children: (bacSections || []).map(sec => {
                        const sectionTracks = (bacTracks || []).filter(t => t.section_id === sec.id);
                        return {
                          id: `${g.id}-${sec.id}`,
                          section_id: sec.id,
                          grade_id: g.id,
                          type: 'section',
                          name: sec.name,
                          children: sectionTracks.map(track => {
                             const trackSubjIds = trackSubjLinks.filter(ts => ts.track_id === track.id).map(ts => ts.subject_id);
                             const subjectsForTrack = (subjects || []).filter(s => trackSubjIds.includes(s.id)).map(s => ({
                               id: `${track.id}-${s.id}`,
                               subject_id: s.id,
                               track_id: track.id,
                               grade_id: g.id,
                               type: 'subject',
                               name: s.name
                             }));
                             return {
                               id: track.id,
                               type: 'track',
                               name: track.name,
                               children: subjectsForTrack
                             };
                          })
                        };
                      })
                    };
                  }

                  const gSubjs = (gradeSubjs || []).filter(gs => gs.grade_id === g.id);
                  const subjectsForGrade = gSubjs.map(gs => {
                     const s = subjMap.get(gs.subject_id);
                     return {
                        id: gs.id, 
                        subject_id: s?.id,
                        grade_id: g.id,
                        type: 'subject',
                        name: s?.name || 'Unknown'
                     };
                  });
                  return {
                     id: g.id,
                     type: 'grade',
                     name: g.name,
                     children: subjectsForGrade
                  }
               })
            }
          })
        };
      });

      setTreeData(tree);

    } catch(err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleNode = (nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        // Find nodes at the same "level" (depth) is complex with a flat Set of IDs
        // but it significantly controls space to keep only targeted branches open.
        next.add(nodeId);
      }
      return next;
    });
  };

  const handleNodeClick = (node: any) => {
    setActiveNode(node);
    generateTasksForNode(node);
  };

  const generateTasksForNode = async (node: any) => {
    if (!supabaseUrl || !supabaseKey) return;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const tasks = [];

    if (node.type === 'curriculum') {
      tasks.push({
        title: 'Define Cycles',
        status: node.children?.length > 0 ? 'completed' : 'actionable',
        desc: node.children?.length > 0 ? 'Cycles are populated.' : 'Add cycles (Primary, Middle, High School) for this curriculum.',
        prompt: `Generate a JSON array of cycles for ${node.name}. Return only [{name, cycle_order}]. Do not invent IDs; curriculum_id is already known externally.`
      });
    } else if (node.type === 'cycle') {
      tasks.push({
        title: 'Define Grades',
        status: node.children?.length > 0 ? 'completed' : 'actionable',
        desc: node.children?.length > 0 ? 'Grades are populated.' : 'Add the specific grade levels inside this cycle.',
        prompt: `Generate a JSON array of grades for the cycle ${node.name}. Return only [{name, grade_order}]. Do not invent IDs; cycle_id is already known externally.`
      });
    } else if (node.type === 'grade') {
      tasks.push({
        title: 'Map Subjects',
        status: node.children?.length > 0 ? 'completed' : 'actionable',
        desc: node.children?.length > 0 ? 'Subjects are mapped.' : 'Identify which subjects are taught in this exact grade.',
        prompt: `Generate a JSON array of official subjects for ${node.name}. Return only [{name}]. Subject names must be canonical and reusable across grades.`
      });
      if (node.name.toLowerCase().includes('bac') || node.name.includes('البكالوريا')) {
         tasks.push({
           title: 'Verify Sections & Tracks',
           status: node.children?.length > 0 ? 'completed' : 'actionable',
           desc: 'Ensure the specialized Baccalaureate sections and tracks are correctly populated and mapped.',
           prompt: `Generate a JSON array of Bac tracks for ${node.name}. Return only [{section_name, track_code, name, description, track_order}]. section_name must match an existing Bac section exactly; do not invent IDs.`
         });
      }
    } else if (node.type === 'section') {
      tasks.push({
        title: 'Define Tracks',
        status: node.children?.length > 0 ? 'completed' : 'actionable',
        desc: `Add specific tracks for the ${node.name} section (e.g., PC, SVT).`,
        prompt: `Generate a JSON array of tracks for the ${node.name} section in Moroccan Bac. Return only [{track_code, name, description, track_order}]. Do not invent IDs; section_id is already known externally.`
      });
    } else if (node.type === 'track') {
      tasks.push({
        title: 'Map Track Subjects',
        status: node.children?.length > 0 ? 'completed' : 'actionable',
        desc: `Assign subjects to the ${node.name} track.`,
        prompt: `Generate a JSON array of canonical subject mappings for the ${node.name} Bac track. Return only [{subject_name}]. subject_name must match existing subjects exactly.`
      });
    } else if (node.type === 'subject') {
      // Need to query topics for this specific grade + subject
      const { data: topics } = await supabase.from('topics').select('*').eq('grade_id', node.grade_id).eq('subject_id', node.subject_id);
      const hasTopics = topics && topics.length > 0;
      
      tasks.push({
        title: 'Build Syllabus Topics',
        status: hasTopics ? 'completed' : 'actionable',
        desc: hasTopics ? `${topics.length} topics logged.` : `This subject is mapped but lacks topics.`,
        prompt: `Generate a JSON array of syllabus topics for ${node.name} in this specific grade. Return only [{title, topic_order}]. Do not invent IDs; grade_id and subject_id are already known externally.`
      });

      if (hasTopics) {
        tasks.push({
          title: 'Lesson Outlines & Exercises',
          status: 'actionable',
          desc: 'Select individual topics below to generate deeper content.',
          prompt: null
        });
      }
    }

    setNodeTasks(tasks);
  };

  const renderTree = (nodes: any[], depth = 0) => {
    return nodes.map((node: any) => {
      const isExpanded = expandedNodes.has(node.id);
      const isLeaf = !node.children || node.children.length === 0;
      const isActive = activeNode?.id === node.id;

      let icon = <Database className="w-3.5 h-3.5 text-white/40" />;
      if (node.type === 'subject') icon = <Component className="w-3.5 h-3.5 text-blue-400" />;
      if (node.type === 'grade') icon = <FileText className="w-3.5 h-3.5 text-green-400" />;
      if (node.type === 'section') icon = <Layers className="w-3.5 h-3.5 text-purple-400" />;
      if (node.type === 'track') icon = <Activity className="w-3.5 h-3.5 text-orange-400" />;

      return (
        <div key={node.id} className="w-full">
          <div 
            className={`flex items-center gap-2 py-1 px-2 rounded-lg cursor-pointer transition-colors ${isActive ? 'bg-[#3ECF8E]/20 text-[#3ECF8E]' : 'hover:bg-white/5 text-white/70'}`}
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
            onClick={(e) => {
               if (!isLeaf) toggleNode(node.id);
               handleNodeClick(node);
            }}
          >
            <span className="w-4 h-4 flex items-center justify-center">
              {!isLeaf && (
                 isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
              )}
            </span>
            {icon}
            <span className="text-xs font-medium truncate">{node.name}</span>
          </div>
          
          {isExpanded && !isLeaf && (
            <div className="flex flex-col">
              {renderTree(node.children, depth + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="flex flex-col lg:flex-row min-h-full border border-white/10 rounded-2xl overflow-hidden bg-black/40 backdrop-blur-md">
      
      {/* LEFT: Tree View */}
      <div className="w-full lg:w-[300px] border-b lg:border-b-0 lg:border-r border-white/10 p-4 flex flex-col bg-black/20 lg:h-[calc(100vh-140px)] lg:sticky lg:top-0">
         <h2 className="text-[9px] uppercase tracking-[0.2em] font-black text-white/30 mb-3 px-2">Task Tree</h2>
         <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar -mx-2 px-2 pb-4">
            {isLoading ? (
               <div className="flex items-center gap-3 text-white/40 p-4">
                  <div className="w-4 h-4 rounded-full border-2 border-white/20 border-t-transparent animate-spin"></div>
                  <span className="text-xs">Mapping hierarchy...</span>
               </div>
            ) : treeData.length > 0 ? (
               <div className="space-y-0.5">
                  {renderTree(treeData)}
               </div>
            ) : (
               <p className="text-xs text-white/40 px-2">No data found or Supabase disabled.</p>
            )}
         </div>
      </div>

      {/* RIGHT: Granular Workstation */}
      <div className="flex-1 bg-black/10 overflow-y-auto min-h-0 custom-scrollbar p-8">
         {!activeNode ? (
            <div className="h-full flex flex-col justify-center items-center text-center text-white/40">
               <Database className="w-12 h-12 mb-4 opacity-50" />
               <h3 className="text-xl font-light text-white mb-2">Select a node</h3>
               <p className="text-sm max-w-md">Use the hierarchical tree on the left to drill down into your curriculum. Generating exact AI prompts guarantees data consistency.</p>
            </div>
         ) : (
            <div className="max-w-3xl mx-auto space-y-8">
               
               <header className="border-b border-white/10 pb-4">
                  <div className="flex items-center gap-3 mb-1.5 text-[#3ECF8E]">
                     <span className="px-2 py-0.5 text-[9px] uppercase font-black tracking-widest bg-[#3ECF8E]/10 rounded border border-[#3ECF8E]/20">
                        {activeNode.type}
                     </span>
                  </div>
                  <h1 className="text-xl font-light text-white mb-1">{activeNode.name}</h1>
                  <p className="text-white/40 text-xs">Follow the actions below to hydrate this specific segment.</p>
               </header>

               <div className="space-y-3">
                  {nodeTasks.length > 0 ? nodeTasks.map((t, idx) => {
                     const isCompleted = t.status === 'completed';
                     return (
                        <div key={idx} className={`p-4 rounded-2xl border flex flex-col gap-3 transition-all ${isCompleted ? 'bg-green-500/5 border-green-500/10' : 'bg-white/5 border-white/10 shadow-sm'}`}>
                           <div className="flex items-start gap-3">
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center font-black text-[10px] shrink-0 ${isCompleted ? 'bg-green-500/20 text-green-500 border border-green-500/30' : 'bg-[#3ECF8E]/20 text-[#3ECF8E] border border-[#3ECF8E]/30'}`}>
                                 {isCompleted ? <CheckCircle2 className="w-3.5 h-3.5" /> : idx + 1}
                              </div>
                              <div className="flex-1">
                                 <h4 className={`text-sm font-medium ${isCompleted ? 'text-green-500/80 line-through decoration-green-500/30' : 'text-white/90'}`}>
                                 {t.title}
                                 </h4>
                                 <p className={`text-[11px] leading-relaxed mt-0.5 ${!isCompleted ? 'text-white/60' : 'text-white/30'}`}>{t.desc}</p>
                              </div>
                           </div>
                           {!isCompleted && t.prompt && (
                              <div className="ml-10 flex items-center gap-2">
                                 <div className="flex-1 bg-black/40 border border-white/5 px-3 py-2 rounded-lg text-[10px] font-mono text-white/30 overflow-hidden text-ellipsis select-all">
                                 {t.prompt}
                                 </div>
                                 <button 
                                 onClick={() => navigator.clipboard.writeText(t.prompt)}
                                 className="p-2.5 bg-[#3ECF8E]/10 text-[#3ECF8E] hover:bg-[#3ECF8E] hover:text-black rounded-lg transition-all shrink-0"
                                 title="Copy AI Prompt"
                                 >
                                 <Copy className="w-3.5 h-3.5" />
                                 </button>
                              </div>
                           )}
                        </div>
                     );
                  }) : (
                    <p className="text-white/40 text-sm italic">Scanning internal hierarchies...</p>
                  )}
               </div>

            </div>
         )}
      </div>

    </div>
  );
}

