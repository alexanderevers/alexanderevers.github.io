/**
 * Chart Factory module for creating chart configurations.
 * Depends on functions from utils.js
 */

function prepareChartData(data, maxFastTime) {
    const lapNumbers = [];
    const lapTimesInSeconds = [];
    const backgroundColors = [];
    const borderColors = [];
    const borderWidths = [];
    
    let minLapTime = Infinity;
    data.forEach(lap => {
        const lapTime = parseDurationToSeconds(lap.duration);
        if (lapTime < minLapTime) minLapTime = lapTime;
    });
    const yAxisMin = Math.max(0, minLapTime - 5);

    data.forEach(lap => {
        lapNumbers.push(`Lap ${lap.nr}`);
        const lapTime = parseDurationToSeconds(lap.duration);
        lapTimesInSeconds.push(lapTime);

        if (lapTime <= maxFastTime) {
            backgroundColors.push('rgba(0, 123, 255, 0.8)');
            if (lap.status === 'FASTER') {
                borderColors.push('rgba(46, 204, 113, 0.9)');
                borderWidths.push(3);
            } else if (lap.status === 'SLOWER') {
                borderColors.push('rgba(231, 76, 60, 0.9)');
                borderWidths.push(3);
            } else {
                borderColors.push('rgba(0, 123, 255, 1)');
                borderWidths.push(1);
            }
        } else {
            backgroundColors.push('rgba(173, 216, 230, 0.6)');
            borderColors.push('rgba(173, 216, 230, 0.8)');
            borderWidths.push(1);
        }
    });
    return { lapNumbers, lapTimesInSeconds, backgroundColors, borderColors, borderWidths, yAxisMin };
}

function getChartOptions(yAxisMin, showDataLabels, fullLapData, hoveredRowIndex, maxFastTime, mainChartInstance, contextChartInstance, currentFullLapData, startIndex = 0) {
    return {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
            x: { 
                beginAtZero: false, min: yAxisMin, max: maxFastTime + 0,
                ticks: { callback: value => formatSecondsToDuration(value) }
            },
            xTop: {
                position: 'top', beginAtZero: false, min: yAxisMin, max: maxFastTime + 0,
                ticks: { callback: value => formatSecondsToDuration(value) },
                grid: { drawOnChartArea: false }
            },
            y: { 
                ticks: {
                    font: function(context) {
                        let indexToMatch;
                        // Use showDataLabels to distinguish between the main chart (true) and context chart (false)
                        if (showDataLabels) { // This is the main chart
                            indexToMatch = hoveredRowIndex;
                        } else { // This is the context chart
                            indexToMatch = hoveredRowIndex - startIndex;
                        }
                        if (context.index === indexToMatch) {
                            return { weight: 'bold', size: '14px' };
                        }
                        return { weight: 'normal', size: '12px' };
                    }
                }
            }
        },
        plugins: {
            legend: { display: false },
            tooltip: {
                callbacks: {
                    label: function(context) {
                        const dataIndex = context.dataIndex;
                        let lap;
                        if (showDataLabels) { // This is the main chart
                            lap = currentFullLapData[dataIndex];
                        } else { // This is the context chart
                            lap = currentFullLapData[startIndex + dataIndex];
                        }
                        if (!lap) return '';
                        const tooltipLines = [];
                        tooltipLines.push(`Duration: ${lap.duration}`);
                        if (lap.dateTimeStart) {
                            tooltipLines.push(`Lap Start: ${formatTime(lap.dateTimeStart)}`);
                        }
                        if (lap.diffPrevLap) {
                            const sign = lap.status === 'SLOWER' ? '+' : '-';
                            tooltipLines.push(`Diff: ${sign}${lap.diffPrevLap}`);
                        }
                        tooltipLines.push(`Session: ${lap.sessionDuration || 'N/A'}`);
                        const speed = lap.speed?.kph?.toFixed(1) || 'N/A';
                        tooltipLines.push(`Speed: ${speed} km/h`);
                        return tooltipLines;
                    }
                }
            },
            datalabels: {
                display: showDataLabels ? function(context) {
                    const lap = fullLapData[context.dataIndex];
                    const lapTime = context.dataset.data[context.dataIndex];
                    if (lapTime > 90 || lapTime > maxFastTime || !lap || !lap.diffPrevLap) return false;
                    const absoluteDiffString = lap.diffPrevLap.replace(/^[+-]/, '');
                    if (parseDurationToSeconds(absoluteDiffString) > 30) return false;
                    return true;
                } : false,
                anchor: 'end',
                align: 'left',
                offset: 4,
                color: 'black',
                font: { weight: 'bold' },
                formatter: function(value, context) {
                    const lap = fullLapData[context.dataIndex];
                    const sign = lap.status === 'SLOWER' ? '+' : '-';
                    const absoluteDiffString = lap.diffPrevLap.replace(/^[+-]/, '');
                    const diffSeconds = parseDurationToSeconds(absoluteDiffString);
                    return `${sign}${diffSeconds.toFixed(1)}`;
                }
            }
        }
    };
}