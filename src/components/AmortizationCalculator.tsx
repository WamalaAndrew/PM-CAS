import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Calculator } from 'lucide-react';

interface AmortizationRow {
  month: number;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
}

export function AmortizationCalculator() {
  const [principal, setPrincipal] = useState<number>(1000000);
  const [annualInterestRate, setAnnualInterestRate] = useState<number>(24); // 24% annual
  const [months, setMonths] = useState<number>(12);
  const [schedule, setSchedule] = useState<AmortizationRow[]>([]);

  const calculate = () => {
    const monthlyRate = (annualInterestRate / 100) / 12;
    const p = principal;
    const n = months;

    if (p <= 0 || monthlyRate <= 0 || n <= 0) {
      setSchedule([]);
      return;
    }

    // PMT = P * (r * (1 + r)^n) / ((1 + r)^n - 1)
    const monthlyPayment = p * (monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1);

    let balance = p;
    const newSchedule: AmortizationRow[] = [];

    for (let i = 1; i <= n; i++) {
      const interestPayment = balance * monthlyRate;
      let principalPayment = monthlyPayment - interestPayment;

      if (i === n) {
        // Adjust last payment to avoid rounding issues
        principalPayment = balance;
      }

      balance -= principalPayment;

      newSchedule.push({
        month: i,
        payment: principalPayment + interestPayment,
        principal: principalPayment,
        interest: interestPayment,
        balance: Math.max(0, balance),
      });
    }

    setSchedule(newSchedule);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'UGX' }).format(amount);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Calculator className="h-6 w-6 text-blue-600" />
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Loan Amortization Calculator</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Loan Parameters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label>Loan Amount (UGX)</Label>
              <Input 
                type="number" 
                value={principal} 
                onChange={(e) => setPrincipal(Number(e.target.value))}
                min={0}
              />
            </div>
            <div className="space-y-2">
              <Label>Annual Interest Rate (%)</Label>
              <Input 
                type="number" 
                value={annualInterestRate} 
                onChange={(e) => setAnnualInterestRate(Number(e.target.value))}
                min={0}
                step={0.1}
              />
            </div>
            <div className="space-y-2">
              <Label>Tenure (Months)</Label>
              <Input 
                type="number" 
                value={months} 
                onChange={(e) => setMonths(Number(e.target.value))}
                min={1}
              />
            </div>
          </div>
          <Button onClick={calculate} className="mt-6 w-full md:w-auto">Calculate Schedule</Button>
        </CardContent>
      </Card>

      {schedule.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Amortization Schedule</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Principal</TableHead>
                  <TableHead>Interest</TableHead>
                  <TableHead>Remaining Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedule.map((row) => (
                  <TableRow key={row.month}>
                    <TableCell>{row.month}</TableCell>
                    <TableCell className="font-medium">{formatCurrency(row.payment)}</TableCell>
                    <TableCell>{formatCurrency(row.principal)}</TableCell>
                    <TableCell>{formatCurrency(row.interest)}</TableCell>
                    <TableCell>{formatCurrency(row.balance)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
