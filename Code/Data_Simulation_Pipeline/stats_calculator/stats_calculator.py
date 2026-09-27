import numpy as np
import matplotlib.pyplot as plt
import logging
class StatsCalculator:
    def __init__(self, infarction_val=3, myocardium_val=2, no_flow_val=4):
        """
        Initialize the StatsCalculator with customizable label values.
        
        Args:
            infarction_val: Value representing infarction in the mask
            myocardium_val: Value representing myocardium in the mask
            no_flow_val: Value representing no flow regions in the mask
        """
        self.INFARCTION = infarction_val
        self.MYOCARDIUM = myocardium_val
        self.NO_FLOW = no_flow_val
    
    def calculate_percentages(self, mask):
        """
        Calculate percentages of infarction and no flow areas in the mask.
        
        Args:
            mask: The input mask array
            
        Returns:
            Tuple of (infarct_to_myo, noflow_to_infarct)
        """
        infarct_pixels = np.sum(mask == self.INFARCTION)
        myocardium_pixels = np.sum(mask == self.MYOCARDIUM)
        no_flow_pixels = np.sum(mask == self.NO_FLOW)

        infarct_plus_noflow = infarct_pixels + no_flow_pixels
        myocardium_total = myocardium_pixels + infarct_plus_noflow

        # Avoid division by zero
        infarct_to_myo = infarct_plus_noflow / myocardium_total if myocardium_total > 0 else 0.0
        noflow_to_infarct = no_flow_pixels / infarct_plus_noflow if infarct_plus_noflow > 0 else 0.0

        return infarct_to_myo, noflow_to_infarct

    def process_mask(self, mask,infarct_to_myo_upper_limit,infarct_to_myo_lower_limit,
                      noflow_to_infarct_upper_limit, noflow_to_infarct_lower_limit):
        """
        Process a single mask and return statistics.
        
        Args:
            mask: The input mask array
            
        Returns:
            dict: Dictionary containing calculated statistics
        """
        infarct_to_myo, noflow_to_infarct = self.calculate_percentages(mask)
        logging.info(f"Calculated infarct_to_myo: {infarct_to_myo}, noflow_to_infarct: {noflow_to_infarct}")
        has_significant_infarct = (infarct_to_myo >= infarct_to_myo_upper_limit) or (infarct_to_myo <= infarct_to_myo_lower_limit)
        has_significant_noflow = (noflow_to_infarct >= noflow_to_infarct_upper_limit) or (noflow_to_infarct <= noflow_to_infarct_lower_limit)
        has_significant_infarct_or_noflow = has_significant_infarct or has_significant_noflow
        logging.info(f"Significant infarct: {has_significant_infarct}, Significant no flow: {has_significant_noflow}")
        return {
            "infarct_to_myo": infarct_to_myo,
            "noflow_to_infarct": noflow_to_infarct,
            "has_significant_infarct": has_significant_infarct,
            "has_significant_noflow": has_significant_noflow,
            "has_significant_infarct_or_noflow": has_significant_infarct_or_noflow
        }

    def has_significant_infarct_or_noflow(self, mask, i):
        """
        Check if the mask has significant infarct or no flow areas.
        
        Args:
            mask: The input mask array
            
        Returns:
            bool: True if significant infarct or no flow is present, False otherwise
        """
        stats = self.process_mask(mask)
        logging.info(f"Generated image {i} statistics: {stats}")
        return stats["has_significant_infarct"] or stats["has_significant_noflow"]
    
    @staticmethod
    def plot_results(infarct_to_myo_list, noflow_to_infarct_list):
        """
        Plot histograms of the infarction and no flow statistics.
        
        Args:
            infarct_to_myo_list: List of infarct to myocardium ratios
            noflow_to_infarct_list: List of no flow to infarction ratios
        """
        fig, axs = plt.subplots(1, 2, figsize=(12, 5))

        # Plot 1: Infarct + NoFlow / Total Myocardium
        axs[0].hist(infarct_to_myo_list, bins=20, color='skyblue', edgecolor='black')
        avg1 = np.mean(infarct_to_myo_list)
        axs[0].axvline(avg1, color='red', linestyle='--', label=f'Average = {avg1:.2f}')
        axs[0].set_title('% Infarction+NoFlow to Myocardium')
        axs[0].set_xlabel('Ratio')
        axs[0].set_ylabel('Frequency')
        axs[0].legend()

        # Plot 2: NoFlow / (Infarct + NoFlow)
        axs[1].hist(noflow_to_infarct_list, bins=20, color='lightgreen', edgecolor='black')
        avg2 = np.mean(noflow_to_infarct_list)
        axs[1].axvline(avg2, color='red', linestyle='--', label=f'Average = {avg2:.2f}')
        axs[1].set_title('% NoFlow to (Infarction + NoFlow)')
        axs[1].set_xlabel('Ratio')
        axs[1].set_ylabel('Frequency')
        axs[1].legend()

        plt.tight_layout()
        plt.show()
