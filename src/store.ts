import { create } from 'zustand';
import { useMemo } from 'react';
import { calculatePhaseRestValue, calculateTree } from './core';
import type { AllocNode, ProjectData, PhaseData, ProjectView,
            PreAllocationRule, NodeLayoutType, PreAllocation } from './data';
import { RuleType } from './data';

export type DropPosition = 'inside' | 'before' | 'after';
interface BaseState {
    projects: ProjectData[];
    activeProjectId: string;
    activePhaseId: string;
    selectedNodeId: string | null;
    clipboard: {node: AllocNode, view: ProjectView} | null;
    projectsSaved: Record<string, boolean>;

    addProject: () => void;
    switchProject: (id: string) => void;
    removeProject: (id: string) => void;
    loadProject: (data: ProjectData) => void;
    updateProjectName: (id: string, name: string) => void;
    setTotalValue: (id: string, val: number) => void;
    markSaved: (id: string, saved?: boolean) => void;

    addPhase: () => void;
    switchPhase: (id: string) => void;
    removePhase: (id: string) => void;
    updatePhaseName: (id: string, name: string) => void;
    setPhaseValue: (id: string, val: number) => void;

    addPreAllocation: () => void;
    removePreAllocation: (id: string) => void;
    updatePreAllocationName: (id: string, name: string) => void;
    updatePreAllocationRule: (id: string, rule: Partial<PreAllocationRule>) => void;

    addNode: (parentId: string, name: string) => void;
    removeNode: (id: string) => void;
    moveNode: (sourceId: string, targetId: string, position: DropPosition) => void;
    updateNodeName: (id: string, name: string) => void;
    updateNodeRule: (id: string, rule: Partial<AllocNode['rule']>) => void;
    toggleNodeLayout: (id: string) => void;
    selectNode: (id: string | null) => void;
    copyNode: () => void;
    pasteNode: () => void;

}

// --- 辅助函数 ---
const findParent = (root: AllocNode, targetId: string): AllocNode | null => {
    if (root.children.some(c => c.id === targetId)) {
        return root;
    }
    for (const child of root.children) {
        const parent = findParent(child, targetId);
        if (parent) return parent;
    }
    return null;
};

const createDefaultProject = (id: string, layout: NodeLayoutType, name: string) => {
    return {
        id: id,
        name: name,
        totalValue: 0,
        phases: [createDefaultPhase(crypto.randomUUID(), layout, "入账")],
    }
};

const createDefaultPhase = (id: string, layout: NodeLayoutType, name: string): PhaseData => {
    const rootId = crypto.randomUUID();
    return {
        id: id,
        name,
        phaseValue: 0,
        preAllocations: [],
        rootNode: {
            id: rootId,
            name: '',
            rule: { type: RuleType.FIXED, value: 0 },
            children: []
        },
        view: {nodeLayouts: {[rootId]: layout}}
    }
}

const findNode = (node: AllocNode, id: string): AllocNode | null => {
    if (node.id === id) return node;
    for (const child of node.children) {
        const found = findNode(child, id);
        if (found) return found;
    }
    return null;
};

const cloneNodeNewIds = (node: AllocNode): {node: AllocNode, ids: Record<string, string>} => {
    const props = node.children.map(cloneNodeNewIds);
    const newId = crypto.randomUUID();
    return {
        node: {
            ...node,
            id: newId,
            children: props.map(p => p.node),
        },
        ids: {...(Object.assign({}, ...props.map(p => p.ids))), [node.id]: newId},
    }
}

const clonePhaseNewIds = (phase: PhaseData): PhaseData => {
    const {ids, node} = cloneNodeNewIds(phase.rootNode);
    const newLayouts: Record<string, NodeLayoutType> = {};
    Object.entries(ids).forEach(([oldId, newId]) => {
        const layout = phase.view.nodeLayouts[oldId];
        if (layout === undefined) throw new Error;
        newLayouts[newId] = layout;
    })
    return {
        ...phase,
        id: crypto.randomUUID(),
        rootNode: node,
        view: {
            nodeLayouts: newLayouts,
        }
    }
}

const isDescendant = (sourceNode: AllocNode, targetId: string): boolean => {
    if (sourceNode.id === targetId) return true;
    return sourceNode.children.some(child => isDescendant(child, targetId));
};

const updateTree = (root: AllocNode, targetId: string, updater: (node: AllocNode) => void): AllocNode => {
    const newRoot = { ...root, children: [...root.children] };
    if (newRoot.id === targetId) {
        updater(newRoot);
        return newRoot;
    }
    newRoot.children = newRoot.children.map(child => updateTree(child, targetId, updater));
    return newRoot;
};

const removeFromTree = (root: AllocNode, targetId: string): AllocNode => {
    const newRoot = { ...root, children: [...root.children] };
    newRoot.children = newRoot.children
        .filter(child => child.id !== targetId)
        .map(child => removeFromTree(child, targetId));
    return newRoot;
};

const useBaseStore = create<BaseState>((set) => {
    const initialId = crypto.randomUUID();
    const initialProject = createDefaultProject(initialId, 'horizontal', '新项目');

    return {
        projects: [initialProject],
        activeProjectId: initialId,
        activePhaseId: initialProject.phases[0]!.id,
        selectedNodeId: null,
        clipboard: null,
        projectsSaved: {[initialId]: false},

        addProject: () => {
            set(state => {
                const newId = crypto.randomUUID();
                const newProject = createDefaultProject(newId, 'horizontal', '新项目');
                return {
                    projects: [...state.projects, newProject],
                    activeProjectId: newId,
                    activePhaseId: newProject.phases[0]!.id,
                    projectsSaved: {...state.projectsSaved, [newId]: false},
                };
            });
        },

        switchProject: (id) => {
            set(state => {
                const activeProject = state.projects.find(p => p.id === id)!;
                return {
                    activeProjectId: id,
                    activePhaseId: activeProject.phases[0]!.id,
                }
            })
        },

        removeProject: (id) => {
            set(state => {
                if (state.projects.length <= 1) return state;
                const newProjects = state.projects.filter(p => p.id !== id);
                const newActiveProjectId = state.activeProjectId === id ? newProjects[0]!.id : state.activeProjectId;
                const newActiveProject = state.projects.find(pj => pj.id === newActiveProjectId)!;
                const newActivePhaseId = state.activeProjectId === id ? newActiveProject.phases[0]!.id : state.activePhaseId;
                return {
                    projects: newProjects,
                    activeProjectId: newActiveProjectId,
                    activePhaseId: newActivePhaseId,
                };
            });
        },

        loadProject: (data) => {
            set(state => {
                let ph = data.phases[0];
                if (ph === undefined) {
                    ph = createDefaultPhase(crypto.randomUUID(), 'vertical', '入账');
                    data.phases = [ph];
                }
                if (state.projects.find(p => p.id === data.id)) {
                    return {
                        activeProjectId: data.id,
                        activePhaseId: ph.id,
                    }
                }
                return {
                    projects: [...state.projects, data],
                    activeProjectId: data.id,
                    activePhaseId: ph.id,
                    projectsSaved: {...state.projectsSaved, [data.id]: true},
                }
            });
        },

        updateProjectName: (id, name) => {
            set(state => ({
                projects: state.projects.map(p =>
                    p.id !== id ? p :
                    { ...p, name: name }
                ),
                projectsSaved: {...state.projectsSaved, [id]: false},
            }));
        },

        setTotalValue: (id, val) => {
            set(state => ({
                projects: state.projects.map(p =>
                    p.id === id ? { ...p, totalValue: val } : p
                ),
                projectsSaved: {...state.projectsSaved, [id]: false},
            }));
        },

        markSaved: (id, saved) => {
            set(state => ({
                projectsSaved: {...state.projectsSaved, [id]: saved || true},
            }))
        },

        addPhase: () => {
            set(state => {{
                const activeProject = state.projects.find(pj => pj.id === state.activeProjectId)!;
                const activePhase = activeProject.phases.find(ph => ph.id === state.activePhaseId)!;
                const newPhase = clonePhaseNewIds(activePhase);
                return {
                    projects: state.projects.map(pj => pj.id !== state.activeProjectId ? pj :
                        {...pj, phases: [...pj.phases, newPhase]}
                    ),
                    activePhaseId: newPhase.id,
                    projectsSaved: {...state.projectsSaved, [state.activeProjectId]: false},
                }
            }})
        },

        removePhase: (id) => {
            set(state => {{
                const activeProject = state.projects.find(p => p.id === state.activeProjectId)!;
                if (activeProject.phases.length <= 1) return state;
                const newPhases = activeProject.phases.filter(ph => ph.id !== id);
                return {
                    projects: state.projects.map(pj => pj.id !== state.activeProjectId ? pj :
                        {...pj, phases: newPhases}
                    ),
                    activePhaseId: state.activePhaseId === id ? newPhases[0]!.id : state.activePhaseId,
                    projectsSaved: {...state.projectsSaved, [state.activeProjectId]: false},
                }
            }})
        },

        switchPhase: (id) => {set({activePhaseId: id})},

        updatePhaseName: (id, name) => {
            set(state => {
                return {
                    projects: state.projects.map(pj => pj.id !== state.activeProjectId ? pj :
                        {...pj, phases: pj.phases.map(ph => ph.id !== id ? ph :
                            {...ph, name: name}
                        )}
                    ),
                    projectsSaved: {...state.projectsSaved, [state.activeProjectId]: false},
                }
            })
        },

        setPhaseValue: (id, val) => {
            set(state => {
                return {
                    projects: state.projects.map(pj => pj.id !== state.activeProjectId ? pj :
                        {...pj, phases: pj.phases.map(ph => ph.id !== id ? ph :
                            {...ph, phaseValue: val}
                        )}
                    ),
                    projectsSaved: {...state.projectsSaved, [state.activeProjectId]: false},
                }
            })
        },

        addPreAllocation: () => {
            const newPreAllocation: PreAllocation = {
                id: crypto.randomUUID(),
                name: '',
                rule: { type: "PERCENTAGE", value: 10 },
            }
            set(state => ({
                projects: state.projects.map(pj => pj.id !== state.activeProjectId ? pj :
                    {...pj, phases: pj.phases.map(ph => ph.id !== state.activePhaseId ? ph :
                        {...ph, preAllocations: [...ph.preAllocations, newPreAllocation]}
                    )}
                ),
                projectsSaved: {...state.projectsSaved, [state.activeProjectId]: false},
            }))
        },

        removePreAllocation: (id) => {
            set(state => ({
                projects: state.projects.map(pj => pj.id !== state.activeProjectId ? pj :
                    {...pj, phases: pj.phases.map(ph => ph.id !== state.activePhaseId ? ph :
                        {...ph, preAllocations: ph.preAllocations.filter(pa => pa.id !== id)}
                    )}
                ),
                projectsSaved: {...state.projectsSaved, [state.activeProjectId]: false},
            }))
        },

        updatePreAllocationName(id, name) {
            set(state => ({
                projects: state.projects.map(pj => pj.id !== state.activeProjectId ? pj :
                    {...pj, phases: pj.phases.map(ph => ph.id !== state.activePhaseId ? ph :
                        {...ph, preAllocations: ph.preAllocations.map(pa => pa.id !== id ? pa :
                            {...pa, name: name}
                        )}
                    )}
                ),
                projectsSaved: {...state.projectsSaved, [state.activeProjectId]: false},
            }))
        },

        updatePreAllocationRule(id, rule) {
            set(state => ({
                projects: state.projects.map(pj => pj.id !== state.activeProjectId ? pj :
                    {...pj, phases: pj.phases.map(ph => ph.id !== state.activePhaseId ? ph :
                        {...ph, preAllocations: ph.preAllocations.map(pa => pa.id !== id ? pa :
                            {...pa, rule: {...pa.rule, ...rule}}
                        )}
                    )}
                ),
                projectsSaved: {...state.projectsSaved, [state.activeProjectId]: false},
            }))
        },

        addNode: (parentId, name) => {
            set(state => {
                const activeProject = state.projects.find(pj => pj.id === state.activeProjectId)!;
                const activePhase = activeProject.phases.find(ph => ph.id === state.activePhaseId)!;
                const newId = crypto.randomUUID();
                const newNode: AllocNode = {
                    id: newId,
                    name,
                    rule: { type: RuleType.PERCENTAGE, value: 10 },
                    children: []
                };
                const newRoot = updateTree(activePhase.rootNode, parentId, n => {
                    n.children = [...n.children, newNode];
                });
                const newView: ProjectView = {
                    nodeLayouts: {...activePhase.view.nodeLayouts, [newId]: 'vertical'},
                }

                return {
                    projects: state.projects.map(pj => pj.id !== state.activeProjectId ? pj :
                        {...pj, phases: pj.phases.map(ph => ph.id !== state.activePhaseId ? ph :
                            {...ph, rootNode: newRoot, view: newView}
                        )}
                    ),
                    projectsSaved: {...state.projectsSaved, [state.activeProjectId]: false},
                };
            });
        },

        removeNode: (id) => {
            set(state => {
                const activeProject = state.projects.find(pj => pj.id === state.activeProjectId)!;
                const activePhase = activeProject.phases.find(ph => ph.id === state.activePhaseId)!;
                const newRoot = removeFromTree(activePhase.rootNode, id);
                const {[id]: _, ...newNodeLayouts} = activePhase.view.nodeLayouts;
                const newView: ProjectView = {
                    nodeLayouts: newNodeLayouts,
                }
                return {
                    projects: state.projects.map(pj => pj.id !== state.activeProjectId ? pj :
                        {...pj, phases: pj.phases.map(ph => ph.id !== state.activePhaseId ? ph :
                            {...ph, rootNode: newRoot, view: newView}
                        )}
                    ),
                    projectsSaved: {...state.projectsSaved, [state.activeProjectId]: false},
                };
            });
        },

        moveNode: (sourceId, targetId, position) => {
            set(state => {
                const activeProject = state.projects.find(pj => pj.id === state.activeProjectId)!;
                const activePhase = activeProject.phases.find(ph => ph.id === state.activePhaseId)!;
                const root = activePhase.rootNode;

                if (sourceId === root.id) return state;
                if (sourceId === targetId) return state;

                const sourceNode = findNode(root, sourceId);
                if (!sourceNode) return state;

                if (isDescendant(sourceNode, targetId)) {
                    return state;
                }
                let newRoot = removeFromTree(root, sourceId);

                if (position === 'inside') {
                    newRoot = updateTree(newRoot, targetId, (node) => {
                        node.children = [...node.children, sourceNode];
                    });
                } else {
                    if (targetId === root.id) {
                        newRoot = updateTree(newRoot, targetId, (node) => {
                            node.children.push(sourceNode);
                        });
                    } else {
                        const parent = findParent(newRoot, targetId);
                        if (parent) {
                            newRoot = updateTree(newRoot, parent.id, (parentNode) => {
                                const targetIndex = parentNode.children.findIndex(c => c.id === targetId);
                                if (targetIndex !== -1) {
                                    const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
                                    const newChildren = [...parentNode.children];
                                    newChildren.splice(insertIndex, 0, sourceNode);
                                    parentNode.children = newChildren;
                                }
                            });
                        }
                    }
                }

                return {
                    projects: state.projects.map(pj => pj.id !== state.activeProjectId ? pj :
                        {...pj, phases: pj.phases.map(ph => ph.id !== state.activePhaseId ? ph :
                            {...ph, rootNode: newRoot}
                        )}
                    ),
                    projectsSaved: {...state.projectsSaved, [state.activeProjectId]: false},
                };
            });
        },

        updateNodeName: (nodeId, name) => {
            set(state => {
                const activeProject = state.projects.find(pj => pj.id === state.activeProjectId)!;
                const activePhase = activeProject.phases.find(ph => ph.id === state.activePhaseId)!;
                const isRoot = nodeId === activePhase.rootNode.id;
                if (isRoot) {
                    return state;
                }

                const newRoot = updateTree(activePhase.rootNode, nodeId, n => { n.name = name; });
                return {
                    projects: state.projects.map(pj => pj.id !== state.activeProjectId ? pj :
                        {...pj, phases: pj.phases.map(ph => ph.id !== state.activePhaseId ? ph :
                            {...ph, rootNode: newRoot}
                        )}
                    ),
                    projectsSaved: {...state.projectsSaved, [state.activeProjectId]: false},
                };
            });
        },

        updateNodeRule: (nodeId, rule) => {
            set(state => {
                const activeProject = state.projects.find(pj => pj.id === state.activeProjectId)!;
                const activePhase = activeProject.phases.find(ph => ph.id === state.activePhaseId)!;
                const newRoot = updateTree(activePhase.rootNode, nodeId, n => { n.rule = { ...n.rule, ...rule }; });
                return {
                    projects: state.projects.map(pj => pj.id !== state.activeProjectId ? pj :
                        {...pj, phases: pj.phases.map(ph => ph.id !== state.activePhaseId ? ph :
                            {...ph, rootNode: newRoot}
                        )}
                    ),
                    projectsSaved: {...state.projectsSaved, [state.activeProjectId]: false},
                };
            });
        },

        toggleNodeLayout: (id) => {
            set(state => {
                const activeProject = state.projects.find(pj => pj.id === state.activeProjectId)!;
                const activePhase = activeProject.phases.find(ph => ph.id === state.activePhaseId)!;
                const layoutMap: Record<NodeLayoutType, NodeLayoutType> = {
                    collapsed: 'vertical',
                    vertical: 'horizontal',
                    horizontal: 'collapsed',
                }
                const newLayout: NodeLayoutType = layoutMap[activePhase.view.nodeLayouts[id]??'vertical'];
                const newNodeLayouts = {...activePhase.view.nodeLayouts, [id]: newLayout};
                return {
                    projects: state.projects.map(pj => pj.id !== state.activeProjectId ? pj :
                        {...pj, phases: pj.phases.map(ph => ph.id !== state.activePhaseId ? ph :
                            {...ph, view: {...ph.view, nodeLayouts: newNodeLayouts}}
                        )}
                    ),
                    projectsSaved: {...state.projectsSaved, [state.activeProjectId]: false},
                }
            });
        },

        selectNode: (id) => {
            set({selectedNodeId: id})
        },

        copyNode: () => {
            set(state => {
                if (state.selectedNodeId === null) return state;
                const activeProject = state.projects.find(pj => pj.id === state.activeProjectId)!;
                const activePhase = activeProject.phases.find(ph => ph.id === state.activePhaseId)!;
                const nodeToCopy = findNode(activePhase.rootNode, state.selectedNodeId);
                if (nodeToCopy === null) return state;

                const copiedLayouts: Record<string, NodeLayoutType> = {};
                // traverse
                const nodeStack = [nodeToCopy];
                while (nodeStack.length > 0) {
                    const currentNode = nodeStack.pop()!;
                    copiedLayouts[currentNode.id] = activePhase.view.nodeLayouts[currentNode.id]??'vertical';
                    for (const child of currentNode.children) {
                        nodeStack.push(child);
                    }
                }

                return {
                    clipboard: structuredClone({node: nodeToCopy, view: {nodeLayouts: copiedLayouts}})
                }
            })
        },

        pasteNode: () => {
            set(state => {
                if (state.selectedNodeId === null) return state;
                const clipboard = state.clipboard;
                if (clipboard === null) return state;
                const activeProject = state.projects.find(pj => pj.id === state.activeProjectId)!;
                const activePhase = activeProject.phases.find(ph => ph.id === state.activePhaseId)!;

                const {node: cb, ids} = cloneNodeNewIds(clipboard.node);
                const newRoot = updateTree(activePhase.rootNode, state.selectedNodeId, n => {
                    n.children = [...n.children, cb];
                });
                const newLayouts: Record<string, NodeLayoutType> = activePhase.view.nodeLayouts;
                Object.entries(ids).forEach(([oldId, newId]) => {
                    newLayouts[newId] = clipboard.view.nodeLayouts[oldId]??'vertical';
                })

                return {
                    projects: state.projects.map(pj => pj.id !== state.activeProjectId ? pj :
                        {...pj, phases: pj.phases.map(ph => ph.id !== state.activePhaseId ? ph :
                            {...ph, rootNode: newRoot, view: {...ph.view, nodeLayouts: newLayouts}}
                        )}
                    ),
                    projectsSaved: {...state.projectsSaved, [state.activeProjectId]: false},
                };
            })
        },

    };
});

// 封装useBaseStore hook
export const useStore = () => {
    const state = useBaseStore();

    const activeProject = state.projects.find(pj => pj.id === state.activeProjectId)!;
    const activePhase = activeProject.phases.find(ph => ph.id === state.activePhaseId)!;
    const restValue = calculatePhaseRestValue(activePhase);

    const calculationResult = useMemo(() => {
        return calculateTree(activePhase.rootNode, restValue);
    }, [activePhase.rootNode, restValue]);

    return {
        ...state,
        activePhase,
        activeProject,
        restValue: restValue,
        calculationResult,
    };
};