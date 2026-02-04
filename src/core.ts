// src/core.ts

import type { PhaseData, PreAllocation, ProjectData, AllocNode } from "./data";
import { RuleType } from "./data";

export type CalculationMap = Record<string, {
    amount: number;
    percentOfParent: number;
    isError: boolean;
    isWarning: boolean;
    unallocated: number;
}>;

export const calculateTree = (
    node: AllocNode,
    inputAmount: number,
    resultMap: CalculationMap = {}
): CalculationMap => {

    resultMap[node.id] = {
        amount: inputAmount,
        percentOfParent: 0,
        isError: inputAmount < -0.01,
        isWarning: false,
        unallocated: inputAmount,
    };

    if (!node.children || node.children.length === 0) {
        return resultMap;
    }

    const fixedNodes = node.children.filter(c => c.rule.type === RuleType.FIXED);
    const percentNodes = node.children.filter(c => c.rule.type === RuleType.PERCENTAGE);
    const remainderNodes = node.children.filter(c => c.rule.type === RuleType.REMAINDER);

    let remainingAmount = inputAmount;

    fixedNodes.forEach(child => {
        const allocated = child.rule.value;
        remainingAmount -= allocated;
        calculateTree(child, allocated, resultMap);
        resultMap[child.id]!.percentOfParent = inputAmount === 0 ? 0 : (allocated / inputAmount);
    });

    percentNodes.forEach(child => {
        const allocated = inputAmount * (child.rule.value / 100);
        remainingAmount -= allocated;
        calculateTree(child, allocated, resultMap);
        resultMap[child.id]!.percentOfParent = child.rule.value / 100;
    });

    if (remainderNodes.length > 0) {
        const amountPerNode = remainingAmount / remainderNodes.length;
        remainderNodes.forEach(child => {
            calculateTree(child, amountPerNode, resultMap);
            resultMap[child.id]!.percentOfParent = inputAmount === 0 ? 0 : (amountPerNode / inputAmount);
        });
        resultMap[node.id]!.unallocated = 0;
    } else {
        resultMap[node.id]!.unallocated = remainingAmount;
    }

    resultMap[node.id]!.isError = inputAmount < -0.01 || resultMap[node.id]!.unallocated < -0.01;
    resultMap[node.id]!.isWarning = (!resultMap[node.id]!.isError) &&
        (resultMap[node.id]!.unallocated > 0.01) &&
        (node.children.length > 0);

    return resultMap;
};

const applyPreAllcation = (phaseValue: number, previousValue: number, preAllocation: PreAllocation): number => {
    switch (preAllocation.rule.type) {
        case 'FIXED':
            return previousValue - preAllocation.rule.value;
        case 'PERCENTAGE':
            return previousValue - preAllocation.rule.value / 100 * phaseValue;
    }
}

export const calculatePhaseRestValue = (phase: PhaseData): number => {
    const restValue = phase.preAllocations.reduce(
        (prev, curr) => applyPreAllcation(phase.phaseValue, prev, curr),
        phase.phaseValue
    );
    return restValue;
}

export interface SourceData {
    projectId: string;
    phaseId: string;
    path: string[];
    amount: number;
}
export interface PersonStat {
    name: string;
    totalAmount: number;
    sources: SourceData[];
}

export const aggregateStats = (
    projects: ProjectData[],
): PersonStat[] => {
    const map = new Map<string, PersonStat>();

    projects.forEach((pj) => {
        pj.phases.forEach(ph => { 
            const restValue = calculatePhaseRestValue(ph);
            
            const results = calculateTree(ph.rootNode, restValue);

            const traverse = (node: AllocNode, path: string[]) => {
                const isLeaf = !node.children || node.children.length === 0;

                if (isLeaf && path.length !== 0) {
                    const nodeResult = results[node.id];
                    if (!nodeResult) return;

                    const current = map.get(node.name) || {
                        name: node.name,
                        totalAmount: 0,
                        sources: []
                    };

                    current.totalAmount += nodeResult.amount;
                    current.sources.push({
                        projectId: pj.id,
                        phaseId: ph.id,
                        path: path.slice(1,), // the first element of path must be the name of root, which is always empty string
                        amount: nodeResult.amount
                    });

                    map.set(node.name, current);
                } else {
                    const newPath = [...path, node.name];
                    node.children.forEach((child) => traverse(child, newPath));
                }
            };

            traverse(ph.rootNode, []);
        })
    });

    return Array.from(map.values()).sort((a, b) => b.totalAmount - a.totalAmount);
};